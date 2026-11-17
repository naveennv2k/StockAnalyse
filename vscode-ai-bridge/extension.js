const vscode = require('vscode');
const crypto = require('crypto');
const { createBridge } = require('./bridge-server');

const TOKEN_KEY = 'aiBridge.token';
let bridge;
let statusItem;
let output;

const clip = (s, max = 4000) => (s.length > max ? `${s.slice(0, max)}\n... [${s.length - max} more characters]` : s);

function logConversation(label, text) {
  if (!vscode.workspace.getConfiguration('aiBridge').get('logConversations')) return;
  output.appendLine(`\n[${new Date().toLocaleTimeString()}] ${label}\n${clip(text)}`);
}

async function getToken(context) {
  let token = await context.secrets.get(TOKEN_KEY);
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    await context.secrets.store(TOKEN_KEY, token);
  }
  return token;
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Sends one prompt to a Copilot chat model and returns the full reply text.
async function complete(prompt, signal) {
  const family = vscode.workspace.getConfiguration('aiBridge').get('modelFamily');
  const models = await vscode.lm.selectChatModels(family ? { vendor: 'copilot', family } : { vendor: 'copilot' });
  if (!models.length) throw httpError('No Copilot model available. Sign in to GitHub Copilot in VS Code.', 503);

  const cts = new vscode.CancellationTokenSource();
  signal.addEventListener('abort', () => cts.cancel());
  const startedAt = Date.now();
  logConversation(`REQUEST from app (${prompt.length} chars, model: ${models[0].name})`, prompt);
  try {
    const response = await models[0].sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, cts.token);
    let text = '';
    for await (const chunk of response.text) text += chunk;
    logConversation(`REPLY (${text.length} chars, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`, text);
    return text;
  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      const status = err.code === 'NoPermissions' || err.code === 'Blocked' ? 403 : err.code === 'NotFound' ? 404 : 502;
      throw httpError(`${err.code}: ${err.message}`, status);
    }
    throw err;
  } finally {
    cts.dispose();
  }
}

function updateStatus(port) {
  statusItem.text = bridge.running ? `$(plug) AI Bridge :${port}` : '$(debug-disconnect) AI Bridge off';
  statusItem.tooltip = bridge.running
    ? 'Serving Copilot to local apps on 127.0.0.1. Click to copy the token.'
    : 'AI Bridge is stopped. Click to start.';
  statusItem.command = bridge.running ? 'aiBridge.copyToken' : 'aiBridge.toggle';
}

async function startBridge(context, output) {
  const port = vscode.workspace.getConfiguration('aiBridge').get('port');
  try {
    await bridge.start(port);
  } catch (e) {
    vscode.window.showWarningMessage(`AI Bridge could not listen on port ${port}: ${e.message}`);
  }
  updateStatus(port);
  output.appendLine(bridge.running ? `Listening on 127.0.0.1:${port}` : 'Not running');
}

async function activate(context) {
  output = vscode.window.createOutputChannel('AI Bridge');
  bridge = createBridge({ getToken: () => getToken(context), complete, log: (m) => output.appendLine(m) });
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  statusItem.show();

  context.subscriptions.push(
    output,
    statusItem,
    { dispose: () => bridge.stop() },
    vscode.commands.registerCommand('aiBridge.showLog', () => output.show(true)),
    vscode.commands.registerCommand('aiBridge.copyToken', async () => {
      await vscode.env.clipboard.writeText(await getToken(context));
      vscode.window.showInformationMessage('AI Bridge token copied. Paste it in the app: Integrations > AI > VS Code Copilot.');
    }),
    vscode.commands.registerCommand('aiBridge.regenerateToken', async () => {
      await context.secrets.delete(TOKEN_KEY);
      await vscode.env.clipboard.writeText(await getToken(context));
      vscode.window.showInformationMessage('New AI Bridge token copied. Update it in the app.');
    }),
    vscode.commands.registerCommand('aiBridge.toggle', async () => {
      if (bridge.running) {
        await bridge.stop();
        updateStatus(vscode.workspace.getConfiguration('aiBridge').get('port'));
      } else {
        await startBridge(context, output);
      }
    }),
  );

  await startBridge(context, output);
}

function deactivate() {
  return bridge?.stop();
}

module.exports = { activate, deactivate };
