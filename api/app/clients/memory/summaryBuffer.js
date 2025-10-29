const { logger } = require('@librechat/data-schemas');
const { ConversationSummaryBufferMemory, ChatMessageHistory } = require('langchain/memory');
const { formatLangChainMessages, SUMMARY_PROMPT } = require('../prompts');
const { predictNewSummary } = require('../chains');

const createSummaryBufferMemory = ({ llm, prompt, messages, ...rest }) => {
  const chatHistory = new ChatMessageHistory(messages);
  return new ConversationSummaryBufferMemory({
    llm,
    prompt,
    chatHistory,
    returnMessages: true,
    ...rest,
  });
};

const summaryBuffer = async ({
  llm,
  debug,
  context, // array of messages
  formatOptions = {},
  previous_summary = '',
  prompt = SUMMARY_PROMPT,
  signal,
  preserveToolCalls = false,
}) => {
  if (previous_summary) {
    logger.debug('[summaryBuffer]', { previous_summary });
  }

  let toolCallSummary = '';
  if(preserveToolCalls) {
    const Constants = require('librechat-data-provider').Constants;
    const toolCalls = context
      .filter(msg => msg.tool_calls || msg.content?.some?.(c => c,type ===
      'tool_call'))
      .map(msg => {
        const calls = msg.tool_calls ||
          msg.content?.filter?.(c => c.type === 'tool_call') || [];

        return calls.map(call => {
          const isMCP = call.name?.includes?.(Constants.mcp_delimiter);
          return {
            name: call.name,
            isMCP,
            input: call.input,
            output: call.output ?
              (typeof call.output === 'string' ? call.output.slice(0, 200) :
                JSON.stringify(call.output).slice(0, 200)) : null
          };
        });
      })
      .flat()
      .filter(Boolean);

    if(toolCalls.length > 0) {
      toolCallSummary = '\n\nTool calls in this conversation:\n' +
        toolCalls.map(tc =>
          `-${tc.name}${tc.isMCP ? ' (MCP)' : ''}: ${tc.output || 'pending'}`
        ).join('\n');
    }
  }

  const formattedMessages = formatLangChainMessages(context, formatOptions);
  const memoryOptions = {
    llm,
    prompt,
    messages: formattedMessages,
  };

  if (formatOptions.userName) {
    memoryOptions.humanPrefix = formatOptions.userName;
  }
  if (formatOptions.userName) {
    memoryOptions.aiPrefix = formatOptions.assistantName;
  }

  const chatPromptMemory = createSummaryBufferMemory(memoryOptions);

  const messages = await chatPromptMemory.chatHistory.getMessages();

  if (debug) {
    logger.debug('[summaryBuffer]', { summary_buffer_messages: messages.length });
  }

  const predictSummary = await predictNewSummary({
    messages,
    previous_summary,
    memory: chatPromptMemory,
    signal,
  });

  if (debug) {
    logger.debug('[summaryBuffer]', { summary: predictSummary });
  }

  const finalSummary = predictSummary + toolCallSummary;

  return { role: 'system', content: finalSummary };
};

module.exports = { createSummaryBufferMemory, summaryBuffer };
