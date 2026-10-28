// Agent execution guidance appended to MCP tool descriptions by the Local DC broker.
// Advisory only: do not modify native Desktop Commander schemas or routing.
// Optimize successful task completion rather than ranking technologies.
export const LOCAL_DC_EXECUTION_POLICY = [
  'Local DC execution rule: choose the lowest-overhead reliable method that actually fulfills the user intent; there is no fixed technology priority.',
  'For ordinary local files, processes, logs and data, use available CLI/structured operations when efficient and sufficient. Do not search for, build or favor an interface merely to satisfy a priority slogan.',
  'When the user requests desktop app interaction or a GUI demonstration, actually operate the GUI. Prefer known Windows UI Automation (UIA) controls and invoke/set-value/get-value; fall back to keyboard or clipboard when direct UIA editing is unreliable.',
  'Avoid unnecessary screenshots and visual reasoning. Use screenshots when the task is visual, UIA cannot describe a relevant control/state, or structured verification is inconclusive.',
  'Verify the real result, not merely a successful tool call: read UIA state, files/data/logs/process state, or other structured evidence where possible. Do not screenshot routinely to confirm a file was saved or a calculation succeeded.',
  'Minimize remote round trips: batch known same-window actions with gui_batch; use targeted selectors instead of costly full accessibility-tree scans.',
  'Respect authorized scope and existing permissions; never assume CLI/clipboard operations are permitted for destructive or privileged changes.'
].join(' ');

const compactGuidance = {
  get_config: 'Choose the most reliable low-overhead way to achieve the requested task; no fixed API/CLI/GUI hierarchy. For desktop controls use UIA where practical; verify via structured state instead of unnecessary screenshots.',
  start_process: LOCAL_DC_EXECUTION_POLICY,
  agent_call: 'Select tools according to user intent, reliability, fewest remote calls and execution cost, not a fixed API-first hierarchy. For GUI use UIA; verify actual outcome; screenshot only as visual fallback.',
  gui_status: 'Use GUI tools when desktop interaction is needed or specifically requested. Avoid screenshots by default when UIA or other structured verification is sufficient.',
  gui_windows: LOCAL_DC_EXECUTION_POLICY,
  gui_inspect: 'Prefer known selectors or narrow-depth UIA inspection. Avoid full-tree scans unless necessary; verify with UIA readback or files/logs instead of automatic screenshots.',
  gui_action: 'Prefer UIA invoke/set-value/get-value for known controls; fall back to keyboard/clipboard only as needed. Successful tool invocation is not proof of final success; verify actual UIA state or file/data/log.',
  gui_batch: 'Batch known same-window steps to reduce remote round trips. Verify results via UIA readback or other structured state; do not append screenshots by habit. Stop on failure.',
  gui_screenshot: 'VISUAL FALLBACK: use for explicitly visual tasks, inaccessible/self-drawn controls, or unresolved ambiguity. Do NOT screenshot routinely to confirm saved files, commands or calculations when UIA/files/logs suffice. Include image pixels only when model vision is actually needed.'
};

export function withLocalDcGuidance(tool) {
  const note = compactGuidance[tool.name];
  if (!note) return tool;
  return {
    ...tool,
    description: [tool.description || '', '[Anlan Local DC policy] ' + note].filter(Boolean).join('\n\n')
  };
}