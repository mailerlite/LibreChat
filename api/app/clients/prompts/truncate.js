const MCPTool = require('@librechat/frontend/src/components/SidePanel/Agents/MCPTool');
const MAX_CHAR = 255;
const MAX_TOOL_OUTPUT_TOKENS = 500;

/**
 * Truncates a given text to a specified maximum length, appending ellipsis and a notification
 * if the original text exceeds the maximum length.
 *
 * @param {string} text - The text to be truncated.
 * @param {number} [maxLength=MAX_CHAR] - The maximum length of the text after truncation. Defaults to MAX_CHAR.
 * @returns {string} The truncated text if the original text length exceeds maxLength, otherwise returns the original text.
 */
function truncateText(text, maxLength = MAX_CHAR) {
  if (text.length > maxLength) {
    return `${text.slice(0, maxLength)}... [text truncated for brevity]`;
  }
  return text;
}

/**
 * Truncates a given text to a specified maximum length by showing the first half and the last half of the text,
 * separated by ellipsis. This method ensures the output does not exceed the maximum length, including the addition
 * of ellipsis and notification if the original text exceeds the maximum length.
 *
 * @param {string} text - The text to be truncated.
 * @param {number} [maxLength=MAX_CHAR] - The maximum length of the output text after truncation. Defaults to MAX_CHAR.
 * @returns {string} The truncated text showing the first half and the last half, or the original text if it does not exceed maxLength.
 */
function smartTruncateText(text, maxLength = MAX_CHAR) {
  const ellipsis = '...';
  const notification = ' [text truncated for brevity]';
  const halfMaxLength = Math.floor((maxLength - ellipsis.length - notification.length) / 2);

  if (text.length > maxLength) {
    const startLastHalf = text.length - halfMaxLength;
    return `${text.slice(0, halfMaxLength)}${ellipsis}${text.slice(startLastHalf)}${notification}`;
  }

  return text;
}

/**
 * Enhanced version with progressive truncation and MCP awareness
 * @param {TMessage[]} _messages
 * @param {number} maxContextTokens
 * @param {function({role: string, content: TMessageContent[]}): number} getTokenCountForMessage
 * @param {object} options - Additional options
 * @param {number} options.threshold - Threshold percentage (default 0.75)
 * @param {boolean} options.mcpPriorityBoost - Give MCP tools higher threshold
 *
 * @returns {{
 *  dbMessages: TMessage[],
 *  editedIndices: number[],
 *  stats: {
 *    totalTruncated: number,
 *    mcpTruncated: number,
 *    tokensSaved: number
 *  }
 * }}
 */
function truncateToolCallOutputs(
  _messages,
  maxContextTokens,
  getTokenCountForMessage,
  options = {}) {
  const THRESHOLD_PERCENTAGE = options.threshold || 0.75;
  const MCP_PRIORITY_BOOST = options.mcpPriorityBoost !== false ? 0.15 : 0;
  const targetTokenLimit = maxContextTokens * THRESHOLD_PERCENTAGE;

  let currentTokenCount = 3;
  const messages = [..._messages];
  const processedMessages = [];
  let currentIndex = messages.length;
  const editedIndices = new Set();
  const stats = {
    totalTruncated: 0,
    mcpTruncated: 0,
    tokensSaved: 0
  };

  while (messages.length > 0) {
    currentIndex--;
    const message = messages.pop();
    const originalTokenCount = message.tokenCount;
    currentTokenCount += originalTokenCount;

    const isMCP = message.content?.some(item =>
      item.type === 'tool_call' && isMCPTool(item.tool_call)
    );

    const effectiveThreshold = isMCP
      ? targetTokenLimit * (1 + MCP_PRIORITY_BOOST)
      : targetTokenLimit;

    if (currentTokenCount < effectiveThreshold) {
      processedMessages.push(message);
      continue;
    }

    if (!message.content || !Array.isArray(message.content)) {
      processedMessages.push(message);
      continue;
    }

    const toolCallIndices = message.content
      .map((item, index) => (item.type === 'tool_call' ? index : -1))
      .filter((index) => index !== -1)
      .reverse();

    if (toolCallIndices.length === 0) {
      processedMessages.push(message);
      continue;
    }

    const newContent = [...message.content];
    let messageModified = false;

    // Truncate all tool outputs since we're over threshold
    for (const index of toolCallIndices) {
      const toolCall = newContent[index].tool_call;
      if (!toolCall || !toolCall.output) {
        continue;
      }

      const outputLength = typeof toolCall.output === 'string'
        ? toolCall.output.length
        : JSON.stringify(toolCall.output).length;

      if(outputLength > MAX_TOOL_OUTPUT_TOKENS * 4){
        editedIndices.add(currentIndex);
        messageModified = true;

        const isMCPTool = toolCall.name?.includes?.(
          require('librechat-data-provider').Constants.mcp_delimiter
        );

        const truncateOutput = smartTruncateToolOutput(
          toolCall.output,
          isMCPTool ? MAX_TOOL_OUTPUT_TOKENS * 1.5 : MAX_TOOL_OUTPUT_TOKENS
        );

        newContent[index] = {
          ...newContent[index],
          tool_call: {
            ...toolCall,
            output: '[OUTPUT_OMITTED_FOR_BREVITY]',
          },
        };

        stats.totalTruncated++;
        if(!isMCPTool) stats.mcpTruncated++;
        stats.tokensSaved += Math.max(0, outputLength - truncateOutput.length);
      }
    }

    if(messageModified){
      const truncatedMessage = {
        ...message,
        content: newContent,
        tokenCount: getTokenCountForMessage({ role: 'assistant', content: newContent }),
      };

      currentTokenCount = currentTokenCount - originalTokenCount + truncatedMessage.tokenCount;

      processedMessages.push(truncatedMessage);
    } else {
      processedMessages.push(message);
    }
  }

  return { dbMessages: processedMessages.reverse(), editedIndices: Array.from(editedIndices) };
}

/**
 * @param {string|object} output - The tool output to truncate
 * @param {number} maxTokens - Maximum tokens allowed
 * @returns {string} Truncated output
 */
function smartTruncateToolOutput(output, maxTokens = MAX_TOOL_OUTPUT_TOKENS) {
  //if output is already small enough, return as is
  if(typeof output === 'string' && output.length <= maxTokens * 4) {
    return output;
  }

  //for structured outputs (object/arrays), preserve structure
  if(typeof output === 'object') {
    try {
      const jsonStr = JSON.stringify(output, null, 2);
      if(jsonStr.length <= maxTokens * 4) {
        return jsonStr;
      }

      //Truncate JSON intelligently
      const summary = {
        _truncated: true,
        _originalLength: jsonStr.length,
        _preview: jsonStr.slice(0, maxTokens * 3),
        _type: Array.isArray(output) ? 'array' : 'object',
        _keys: Array.isArray(output) ? output.length : Object.keys(output).length
      };

      return JSON.stringify(summary, null, 2);
    } catch (e) {
      return '[Complex object - truncated for brevity]';
    }
  }

  return smartTruncateText(output, maxTokens * 4);
}

/**
 * Check if a tool is an MCP tool
 * @param {object} toolCall - The tool call object
 * @returns {boolean}
 */
function isMCPTool(toolCall) {
  const Constants = require('librechat-data-provider').Constants;
  return toolCall?.name?.includes?.(Constants.mcp_delimiter);
}



module.exports = { truncateText, smartTruncateText, truncateToolCallOutputs };
