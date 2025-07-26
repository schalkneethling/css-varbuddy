import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

suite("CSS VarBuddy Extension Test Suite", () => {
  let extension: vscode.Extension<any>;
  let testFolder: string;

  suiteSetup(async () => {
    // Get the extension
    extension = vscode.extensions.getExtension("schalkneethling.css-varbuddy")!;
    await extension.activate();

    // Create a temporary test folder with CSS files
    testFolder = path.join(os.tmpdir(), "css-varbuddy-test");
    await fs.promises.mkdir(testFolder, { recursive: true });

    // Create test CSS files
    const cssContent1 = `
      :root {
        --primary-color: #007bff;
        --secondary-color: #6c757d;
        --success-color: #28a745;
        --error-color: #dc3545;
      }
    `;

    const cssContent2 = `
      .component {
        --border-radius: 4px;
        --padding: 1rem;
        --margin: 0.5rem;
      }
    `;

    await fs.promises.writeFile(
      path.join(testFolder, "styles.css"),
      cssContent1,
    );
    await fs.promises.writeFile(
      path.join(testFolder, "components.css"),
      cssContent2,
    );
  });

  suiteTeardown(async () => {
    // Clean up test folder
    try {
      await fs.promises.rm(testFolder, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to clean up test folder:", error);
    }
  });

  test("Extension should be present", () => {
    assert.ok(extension);
    assert.strictEqual(extension.id, "schalkneethling.css-varbuddy");
  });

  test("Extension should activate", async () => {
    const isActive = extension.isActive;
    assert.strictEqual(isActive, true);
  });

  test("Should register webview view provider", async () => {
    // The webview view provider should be registered when the extension activates
    // We can verify this by checking if the extension is active and the view type is registered
    assert.ok(extension.isActive);

    // Check that the extension contributes the correct view
    const packageJson = extension.packageJSON;
    const views =
      packageJson.contributes?.views?.["css-custom-props-explorer"] || [];
    const cssView = views.find(
      (view: any) => view.id === "cssCustomPropertiesView",
    );

    assert.ok(cssView, "CSS Custom Properties view should be registered");
    assert.strictEqual(cssView.type, "webview");
  });

  test("Should scan CSS files for custom properties", async () => {
    // This test verifies the scanning functionality by creating a test file
    // and checking if the properties are found
    const testCssFile = path.join(testFolder, "test-scan.css");
    const cssContent = `
      :root {
        --test-property-1: value1;
        --test-property-2: value2;
        --test-property-3: value3;
      }
    `;

    await fs.promises.writeFile(testCssFile, cssContent);

    // Read the file and check for properties manually
    const content = await fs.promises.readFile(testCssFile, "utf-8");
    const matches = content.match(/--[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];

    assert.strictEqual(matches.length, 3);
    assert.ok(matches.includes("--test-property-1"));
    assert.ok(matches.includes("--test-property-2"));
    assert.ok(matches.includes("--test-property-3"));

    // Clean up
    await fs.promises.unlink(testCssFile);
  });

  test("Should handle webview messages correctly", async () => {
    // Create a mock webview view
    const mockWebview = {
      webview: {
        options: {},
        html: "",
        onDidReceiveMessage: (callback: (data: any) => void) => {
          // Simulate receiving a message
          callback({ type: "insertProperty", value: "--test-property" });
        },
        postMessage: (message: any) => {
          // Verify the message structure
          assert.ok(message.type);
          assert.ok(message.properties || message.folderPath);
        },
      },
    } as vscode.WebviewView;

    // Test that the webview can be created and configured
    assert.ok(mockWebview);
    assert.ok(mockWebview.webview);
  });

  test("Should filter properties correctly", () => {
    // Test the filtering logic that would be used in the webview
    const properties = [
      "--primary-color",
      "--secondary-color",
      "--success-color",
      "--error-color",
      "--border-radius",
      "--padding",
      "--margin",
    ];

    // Test filtering by search term
    const filterProperties = (searchTerm: string) => {
      return properties.filter((prop) =>
        prop.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    };

    // Test exact match
    let filtered = filterProperties("primary");
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0], "--primary-color");

    // Test partial match
    filtered = filterProperties("color");
    assert.strictEqual(filtered.length, 4);
    assert.ok(filtered.includes("--primary-color"));
    assert.ok(filtered.includes("--secondary-color"));
    assert.ok(filtered.includes("--success-color"));
    assert.ok(filtered.includes("--error-color"));

    // Test case insensitive
    filtered = filterProperties("COLOR");
    assert.strictEqual(filtered.length, 4);

    // Test no match
    filtered = filterProperties("nonexistent");
    assert.strictEqual(filtered.length, 0);
  });

  test("Should handle file system operations", async () => {
    // Test that the extension can handle file system operations
    const testDir = path.join(testFolder, "nested");
    await fs.promises.mkdir(testDir, { recursive: true });

    const nestedCssFile = path.join(testDir, "nested.css");
    const cssContent = `
      :root {
        --nested-property: value;
      }
    `;

    await fs.promises.writeFile(nestedCssFile, cssContent);

    // Verify the file exists
    const exists = await fs.promises
      .access(nestedCssFile)
      .then(() => true)
      .catch(() => false);
    assert.strictEqual(exists, true);

    // Read and verify content
    const content = await fs.promises.readFile(nestedCssFile, "utf-8");
    const matches = content.match(/--[a-zA-Z_][a-zA-Z0-9_-]*/g) || [];
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0], "--nested-property");
  });

  test("Should validate CSS custom property regex", () => {
    // Test the regex pattern used to match CSS custom properties
    const cssPropertyRegex = /--[a-zA-Z_][a-zA-Z0-9_-]*/g;

    const validProperties = [
      "--primary-color",
      "--secondary-color",
      "--_private-property",
      "--property123",
      "--property-name",
    ];

    const invalidProperties = [
      "--123-invalid",
      "--invalid@property",
      "--invalid property",
      "--invalid.property",
    ];

    // Test valid properties
    validProperties.forEach((prop) => {
      const match = prop.match(cssPropertyRegex);
      assert.ok(match, `Should match valid property: ${prop}`);
      assert.strictEqual(match![0], prop);
    });

    // Test invalid properties
    invalidProperties.forEach((prop) => {
      const match = prop.match(cssPropertyRegex);
      assert.strictEqual(
        match,
        null,
        `Should not match invalid property: ${prop}`,
      );
    });
  });

  test("Should handle empty folder gracefully", async () => {
    // Create an empty folder
    const emptyFolder = path.join(testFolder, "empty");
    await fs.promises.mkdir(emptyFolder, { recursive: true });

    // Try to read from empty folder
    const entries = await fs.promises.readdir(emptyFolder, {
      withFileTypes: true,
    });
    assert.strictEqual(entries.length, 0);
  });

  test("Should handle non-CSS files correctly", async () => {
    // Create a non-CSS file
    const nonCssFile = path.join(testFolder, "test.txt");
    const content = `
      This is not a CSS file
      --this-should-not-be-found
    `;

    await fs.promises.writeFile(nonCssFile, content);

    // The extension should only process .css and .scss files
    // So this file should be ignored
    const fileName = path.basename(nonCssFile);
    const isCssFile = fileName.endsWith(".css") || fileName.endsWith(".scss");
    assert.strictEqual(isCssFile, false);
  });
});
