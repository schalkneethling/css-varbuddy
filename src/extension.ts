import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export const SELECTED_FOLDER_STORAGE_KEY = "cssVarBuddy.selectedFolder";
export const CSS_CUSTOM_PROPERTY_DECLARATION_REGEX =
  /(?:^|[^A-Za-z0-9_-])(--[A-Za-z_][A-Za-z0-9_-]*)\s*:/gm;
export const CUSTOM_PROPERTY_PLURAL_RULES = new Intl.PluralRules("en-US");

export function formatCustomPropertyCount(count: number) {
  const noun =
    CUSTOM_PROPERTY_PLURAL_RULES.select(count) === "one"
      ? "property"
      : "properties";

  return `${count} custom ${noun}`;
}

export class CustomPropertiesViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _customProperties: string[] = [];
  private _currentFolder?: string;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _workspaceState: vscode.Memento,
  ) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "insertProperty":
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            await editor.edit((editBuilder) => {
              editor.selections.forEach((selection) => {
                editBuilder.insert(selection.active, `var(${data.value})`);
              });
            });
          }
          break;
        case "selectFolder":
          await this.selectFolder();
          break;
        case "refresh":
          if (this._currentFolder) {
            await this.updateProperties(this._currentFolder, {
              notifyOnError: true,
            });
          }
          break;
        case "clearFolder":
          await this.clearSelectedFolder();
          this.postPropertiesUpdate({
            properties: [],
            folderPath: "",
            status: "Selected folder cleared.",
          });
          break;
      }
    });

    await this.restoreSelectedFolder();
  }

  public async refresh() {
    if (this._currentFolder) {
      await this.updateProperties(this._currentFolder, {
        notifyOnError: true,
      });
    }
  }

  public async selectFolder() {
    const folder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select CSS Folder",
    });
    if (folder && folder[0]) {
      await this.selectFolderPath(folder[0].fsPath);
    }
  }

  public async selectFolderPath(folderPath: string) {
    this._currentFolder = folderPath;
    await this._workspaceState.update(SELECTED_FOLDER_STORAGE_KEY, folderPath);
    await this.updateProperties(folderPath, { notifyOnError: true });
  }

  private async updateProperties(
    folderPath: string,
    { notifyOnError } = { notifyOnError: false },
  ) {
    try {
      this._customProperties = await this.scanFolder(folderPath);
      const propertyCount = this._customProperties.length;
      this.postPropertiesUpdate({
        properties: this._customProperties,
        folderPath: folderPath,
        status:
          propertyCount === 0
            ? "No custom properties found."
            : `Found ${formatCustomPropertyCount(propertyCount)}.`,
      });
    } catch (error) {
      if (notifyOnError) {
        vscode.window.showErrorMessage(`Could not scan CSS folder: ${error}`);
      }
      if (await this.isMissingRootFolder(folderPath, error)) {
        await this.clearSelectedFolder();
      } else {
        console.warn(
          `Skipping persisted folder clear because the selected root folder still exists: ${folderPath}`,
        );
      }
      this.postEmptyProperties();
    }
  }

  private async isMissingRootFolder(folderPath: string, error: unknown) {
    if (this.isMissingPathError(error)) {
      try {
        await fs.promises.stat(folderPath);
      } catch (statError) {
        return this.isMissingPathError(statError);
      }
    }

    return false;
  }

  private isMissingPathError(error: unknown) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
  }

  private async restoreSelectedFolder() {
    const selectedFolder = this._workspaceState.get<string>(
      SELECTED_FOLDER_STORAGE_KEY,
    );

    if (selectedFolder) {
      this._currentFolder = selectedFolder;
      await this.updateProperties(selectedFolder);
    }
  }

  private async clearSelectedFolder() {
    this._currentFolder = undefined;
    this._customProperties = [];
    await this._workspaceState.update(SELECTED_FOLDER_STORAGE_KEY, undefined);
  }

  private postEmptyProperties() {
    this.postPropertiesUpdate({
      properties: [],
      folderPath: "",
      status: "Could not scan this folder. Choose another folder or refresh again.",
      statusTone: "error",
    });
  }

  private postPropertiesUpdate({
    properties,
    folderPath,
    status,
    statusTone = "info",
  }: {
    properties: string[];
    folderPath: string;
    status: string;
    statusTone?: "info" | "error";
  }) {
    if (this._view) {
      this._view.webview.postMessage({
        type: "updateProperties",
        properties,
        folderPath,
        status,
        statusTone,
      });
    }
  }

  private async scanFolder(folderPath: string): Promise<string[]> {
    const properties: Set<string> = new Set();
    const files = await this.getAllCssFiles(folderPath);

    for (const file of files) {
      const content = await fs.promises.readFile(file, "utf-8");
      const matches = content.matchAll(CSS_CUSTOM_PROPERTY_DECLARATION_REGEX);
      Array.from(matches).forEach((match) => properties.add(match[1]));
    }

    return Array.from(properties).sort();
  }

  private async getAllCssFiles(folderPath: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.promises.readdir(folderPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.getAllCssFiles(fullPath)));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".css") || entry.name.endsWith(".scss"))
      ) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSS VarBuddy</title>
    <style>
        body {
            padding-block: 0.5rem;
            padding-inline: 0.625rem;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background-color: var(--vscode-editor-background);
        }
        .container {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .topbar {
            align-items: start;
            display: flex;
            gap: 0.5rem;
            justify-content: space-between;
        }
        .folder-summary {
            color: var(--vscode-descriptionForeground);
            flex: 1;
            font-size: 0.92em;
            line-height: 1.35;
            min-inline-size: 0;
        }
        .folder-name {
            color: var(--vscode-foreground);
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .folder-meta {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .toolbar {
            display: flex;
            flex-shrink: 0;
            gap: 0.25rem;
        }
        .toolbar-button,
        .empty-state-button {
            align-items: center;
            background-color: var(--vscode-button-secondaryBackground, transparent);
            border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
            border-radius: 0.25rem;
            color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
            cursor: pointer;
            display: inline-flex;
            justify-content: center;
        }
        .toolbar-button {
            font-size: 1em;
            min-block-size: 1.875rem;
            line-height: 1;
            min-inline-size: 1.875rem;
            padding-block: 0;
            padding-inline: 0.45rem;
        }
        .toolbar-button:hover:not(:disabled),
        .empty-state-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
        }
        .toolbar-button:focus-visible,
        .empty-state-button:focus-visible,
        #searchInput:focus-visible,
        .property-item:focus-visible {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 0.125rem;
        }
        .toolbar-button:disabled {
            cursor: default;
            opacity: 0.45;
        }
        .empty-state {
            align-items: start;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 0.375rem;
            color: var(--vscode-descriptionForeground);
            display: flex;
            flex-direction: column;
            gap: 0.625rem;
            padding: 0.875rem;
        }
        .empty-state-title {
            color: var(--vscode-foreground);
            font-weight: 600;
        }
        .empty-state p {
            margin: 0;
        }
        .empty-state-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding-block: 0.375rem;
            padding-inline: 0.625rem;
        }
        .search-container {
            position: sticky;
            inset-block-start: 0;
            background-color: var(--vscode-editor-background);
            padding-block: 0.25rem;
            padding-inline: 0;
            z-index: 1;
        }
        #searchInput {
            box-sizing: border-box;
            inline-size: 100%;
            padding-block: 0.375rem;
            padding-inline: 0.5rem;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 0.125rem;
        }
        #propertyList {
            list-style: none;
            padding-block: 0;
            padding-inline: 0;
            margin-block: 0;
            margin-inline: 0;
            display: flex;
            flex-direction: column;
            gap: 0.125rem;
        }
        .property-item {
            align-items: center;
            background-color: transparent;
            border: 1px solid transparent;
            border-radius: 0.25rem;
            box-sizing: border-box;
            cursor: pointer;
            display: flex;
            min-block-size: 1.75rem;
            padding-block: 0.25rem;
            padding-inline: 0.375rem;
        }
        .property-item:hover,
        .property-item:focus-visible {
            background-color: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
        }
        .property-code {
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-editor-font-family), monospace;
            font-size: var(--vscode-editor-font-size);
            line-height: 1.35;
            overflow-wrap: anywhere;
        }
        .property-prefix {
            color: var(--vscode-symbolIcon-operatorForeground, var(--vscode-textLink-foreground));
        }
        .property-segment {
            color: var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground));
        }
        .property-separator {
            color: var(--vscode-descriptionForeground);
        }
        .property-item:nth-child(3n + 1) .property-segment {
            color: var(--vscode-symbolIcon-colorForeground, var(--vscode-editor-foreground));
        }
        .property-item:nth-child(3n + 2) .property-segment {
            color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-editor-foreground));
        }
        .property-item:nth-child(3n + 3) .property-segment {
            color: var(--vscode-symbolIcon-constantForeground, var(--vscode-editor-foreground));
        }
        .no-properties {
            color: var(--vscode-descriptionForeground);
            text-align: center;
            padding-block: 1.25rem;
            padding-inline: 1.25rem;
        }
        .status {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            min-height: 1.4em;
        }
        .status.error {
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="emptyState" class="empty-state">
            <div class="empty-state-title">Choose a CSS folder</div>
            <p>Select a folder that contains CSS or SCSS files to index custom properties.</p>
            <button class="empty-state-button" type="button" onclick="selectFolder()">Select CSS folder</button>
        </div>
        <div id="topbar" class="topbar" hidden>
            <div id="folderInfo" class="folder-summary"></div>
            <div class="toolbar" role="toolbar" aria-label="CSS VarBuddy actions">
                <button id="selectFolderButton" class="toolbar-button" type="button" title="Select CSS folder" aria-label="Select CSS folder" onclick="selectFolder()">Folder</button>
                <button id="refreshButton" class="toolbar-button" type="button" title="Refresh custom properties" aria-label="Refresh custom properties" onclick="refresh()">Refresh</button>
                <button id="clearFolderButton" class="toolbar-button" type="button" title="Clear selected folder" aria-label="Clear selected folder" onclick="clearFolder()">Clear</button>
            </div>
        </div>
        <div id="status" class="status" role="status" aria-live="polite"></div>
        <div id="searchContainer" class="search-container" hidden>
            <input type="text" id="searchInput" placeholder="Filter properties..." />
        </div>
        <ul id="propertyList"></ul>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let properties = [];
        let currentFolder = '';

        function selectFolder() {
            vscode.postMessage({ type: 'selectFolder' });
        }

        function refresh() {
            setStatus('Scanning selected folder...');
            vscode.postMessage({ type: 'refresh' });
        }

        function clearFolder() {
            vscode.postMessage({ type: 'clearFolder' });
        }

        function insertProperty(property) {
            vscode.postMessage({ 
                type: 'insertProperty',
                value: property
            });
        }

        function appendToken(parent, className, text) {
            const token = document.createElement('span');
            token.className = className;
            token.textContent = text;
            parent.appendChild(token);
        }

        function renderHighlightedProperty(property) {
            const code = document.createElement('code');
            code.className = 'property-code';

            const prefix = property.startsWith('--') ? '--' : '';
            const name = prefix ? property.slice(2) : property;
            const segments = name.split('-');

            if (prefix) {
                appendToken(code, 'property-prefix', prefix);
            }

            segments.forEach((segment, index) => {
                if (index > 0) {
                    appendToken(code, 'property-separator', '-');
                }

                appendToken(code, 'property-segment', segment);
            });

            return code;
        }

        function filterProperties(searchTerm) {
            const filtered = properties.filter(prop => 
                prop.toLowerCase().includes(searchTerm.toLowerCase())
            );
            renderProperties(filtered);
        }

        function getFolderName(folderPath) {
            const segments = folderPath.split(/[\\\\/]+/).filter(Boolean);

            return segments.pop() || folderPath;
        }

        function getPropertyCountLabel(count) {
            const pluralRules = new Intl.PluralRules('en-US');
            const noun = pluralRules.select(count) === 'one' ? 'property' : 'properties';

            return count + ' custom ' + noun;
        }

        function setStatus(text, tone = 'info') {
            const status = document.getElementById('status');
            status.textContent = text || '';
            status.className = 'status' + (tone === 'error' ? ' error' : '');
        }

        function renderFolderInfo() {
            const topbar = document.getElementById('topbar');
            const emptyState = document.getElementById('emptyState');
            const folderInfo = document.getElementById('folderInfo');
            const searchContainer = document.getElementById('searchContainer');
            const refreshButton = document.getElementById('refreshButton');
            const clearFolderButton = document.getElementById('clearFolderButton');
            const hasFolder = Boolean(currentFolder);

            topbar.hidden = !hasFolder;
            emptyState.hidden = hasFolder;
            searchContainer.hidden = !hasFolder;
            refreshButton.disabled = !hasFolder;
            clearFolderButton.disabled = !hasFolder;

            if (!hasFolder) {
                folderInfo.textContent = '';
                return;
            }

            const folderName = getFolderName(currentFolder) || 'Selected folder';
            folderInfo.innerHTML = '';

            const name = document.createElement('div');
            name.className = 'folder-name';
            name.textContent = folderName;

            const meta = document.createElement('div');
            meta.className = 'folder-meta';
            meta.textContent = getPropertyCountLabel(properties.length);

            folderInfo.appendChild(name);
            folderInfo.appendChild(meta);
        }

        function renderProperties(props) {
            const list = document.getElementById('propertyList');
            list.innerHTML = '';
            renderFolderInfo();
            
            if (props.length === 0 && properties.length > 0) {
                list.innerHTML = '<li class="no-properties">No matching properties found</li>';
                return;
            }
            
            if (properties.length === 0) {
                if (currentFolder) {
                    list.innerHTML = '<li class="no-properties">No custom properties found in this folder</li>';
                }
                return;
            }

            props.forEach(prop => {
                const li = document.createElement('li');
                li.className = 'property-item';
                li.tabIndex = 0;
                li.setAttribute('role', 'button');
                li.setAttribute('aria-label', 'Insert ' + prop);
                li.appendChild(renderHighlightedProperty(prop));
                li.onclick = () => insertProperty(prop);
                li.onkeydown = (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        insertProperty(prop);
                    }
                };
                list.appendChild(li);
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'updateProperties':
                    properties = message.properties;
                    currentFolder = message.folderPath || '';
                    setStatus(message.status || '', message.statusTone || 'info');
                    renderProperties(properties);
                    break;
            }
        });

        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            filterProperties(e.target.value);
        });

        renderProperties(properties);
    </script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new CustomPropertiesViewProvider(
    context.extensionUri,
    context.workspaceState,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "cssCustomPropertiesView",
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
  );
}

export function deactivate() {}
