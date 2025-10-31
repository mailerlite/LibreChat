/**
 * Parses agent context management configuration from librechat.yaml
 * @param {Object} config - The loaded custom configuration object
 * @returns {Object} Parsed agent context management configuration
 */
function parseAgentContextConfig(config) {
  const defaults = {
    toolTruncationThreshold: 0.75,
    mcpPriorityBoost: 0.15,
    autoEnableSummarization: true,
    maxToolOutputTokens: 500,
    preserveToolCallsInSummary: true,
  };

  if (!config?.agents?.contextManagement) {
    return defaults;
  }

  const cm = config.agents.contextManagement;

  return {
    toolTruncationThreshold: cm.toolTruncationThreshold ?? defaults.toolTruncationThreshold,
    mcpPriorityBoost: cm.mcpPriorityBoost ?? defaults.mcpPriorityBoost,
    autoEnableSummarization:
      cm.autoEnableSummarization ?? defaults.autoEnableSummarization,
    maxToolOutputTokens: cm.maxToolOutputTokens ?? defaults.maxToolOutputTokens,
    preserveToolCallsInSummary:
      cm.preserveToolCallsInSummary ?? defaults.preserveToolCallsInSummary,
  };
}

module.exports = {
  parseAgentContextConfig,
};

