// Agent execution guidance added only to the broker's advertised MCP tool descriptions.
// Does not change installed Desktop Commander tools, tool arguments, or routing.
export const LOCAL_DC_EXECUTION_POLICY = [
  'Local DC execution priority (unless the task explicitly requires GUI/visual interaction):',
  '1. Prefer an existing direct API/SDK when appropriate and authorized.',
  '2. Prefer a CLI/shell/structured file or data operation for non-visual work.',
  '3. If desktop interaction is actually required, prefer Windows UI Automation (UIA): target a known window/control and invoke/set-value/get-value; use keyboard/clipboard only when UIA cannot edit the control reliably.',
  '4. Screenshots + visual reasoning are a fallback for inaccessible/self-drawn controls, ambiguous UIA results, or tasks that explicitly require visual verification.',
  'Verify the real outcome, not just the tool exit status: read the actual file/data/log/OS state or UIA value. Do not take routine screenshots just to confirm a file was saved, a process ran, or a calculation succeeded.',
  'Use gui_batch for several known steps on one window to reduce remote round trips. Use narrow selectors and shallow inspection when possible; a large UIA tree can be slower than a screenshot.',
  'Respect user intent and existing permissions. Never assume shell/clipboard is safe for destructive or privileged changes.'
].join(' ');

const compactGuidance = {
  get_config: 'Agent workflow guidance: Prefer API/CLI for nonvisual tasks, Windows UIA for necessary desktop interaction, and screenshots only for visual tasks or unresolved ambiguity. Verify state through files/logs/data/UIA rather than image when feasible.',
  start_process: LOCAL_DC_EXECUTION_POLICY,
  agent_call: 'When selecting child DC tools: prefer API/CLI for nonvisual tasks; GUI UIA only if needed, screenshots last. Independently verify resulting state.',
  gui_status: 'Prioritize API/CLI over GUI when the task does not require desktop interaction; prefer UIA over screenshots for desktop controls.',
  gui_windows: LOCAL_DC_EXECUTION_POLICY,
  gui_inspect: 'Use only if GUI is needed; prefer known selectors or narrow-depth inspection and avoid repeated full-tree scans. Verify results via UIA readback or CLI/filesystem, not automatic screenshots.',
  gui_action: 'Prefer UIA invoke/set-value/get-value on known controls, use keyboard/clipboard fallback only as needed. A successful invoke does not prove the intended task completed: verify the resulting UIA value or actual file/data/log.',
  gui_batch: 'Batch known actions on the SAME window to reduce remote round trips. Prefer UIA reads or CLI/file verification, not automatically adding a screenshot after actions. Failed steps stop the batch; success still needs outcome verification.',
  gui_screenshot: 'LAST-RESORT VISUAL FALLBACK: use only when actual visual appearance is requested, UIA cannot expose the relevant control/state, or nonvisual verification is inconclusive. Do NOT screenshot routinely to confirm saved files, commands, calculations, or other outcomes verifiable via UIA/files/logs. Use include_image only when model vision is genuinely needed.'
};

export function withLocalDcGuidance(tool) {
  const note = compactGuidance[tool.name];
  if (!note) return tool;
  return {
    ...tool,
    description: [tool.description || '', '[Anlan Local DC policy] ' + note].filter(Boolean).join('\n\n')
  };
}
