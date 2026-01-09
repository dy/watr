import { test, expect } from '@playwright/test';

// Helper to get REPL state
async function getState(page) {
  return page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 500)); // Wait for compilation
    return {
      hasState: !!window.state,
      sourceCode: window.state?.sourceCode,
      binaryHtml: window.state?.binaryHtml,
      logHtml: window.state?.logHtml,
      error: window.state?.error,
      compiler: window.state?.compiler,
      prettified: window.state?.prettified,
    };
  });
}

// Helper to set source code
async function setSource(page, code) {
  await page.evaluate((code) => {
    window.state.sourceCode = code;
    window.state.recompile();
  }, code);
  await page.waitForTimeout(500); // Wait for debounced compile
}

test.describe('REPL', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('BROWSER:', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    await page.goto('/repl/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#source')).not.toBeEmpty({ timeout: 10000 });
  });

  test('loads and compiles default example', async ({ page }) => {
    const state = await getState(page);

    expect(state.hasState).toBe(true);
    expect(state.sourceCode).toContain('module');
    expect(state.binaryHtml).toContain('00 61 73 6d'); // wasm magic
    expect(state.logHtml).toContain('Compiled in');
    expect(state.error).toBe(false);
  });

  test('compiles simple module', async ({ page }) => {
    await setSource(page, '(module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))');

    const state = await getState(page);
    expect(state.binaryHtml).toContain('00 61 73 6d');
    expect(state.error).toBe(false);
  });

  test('shows error for invalid code', async ({ page }) => {
    await setSource(page, '(module (invalid syntax here))');

    const state = await getState(page);
    expect(state.error).toBe(true);
    expect(state.logHtml).toBeTruthy(); // Should have error message
  });

  test('switches compilers', async ({ page }) => {
    // Switch to wabt via state (sprae's select binding doesn't work in headless)
    await page.evaluate(async () => {
      window.state.compiler = 'wabt';
      await window.state.recompile();
    });
    await page.waitForTimeout(2000); // wabt takes longer to load

    const state = await getState(page);
    expect(state.compiler).toBe('wabt');
    expect(state.binaryHtml).toContain('00 61 73 6d');
    expect(state.error).toBe(false);
  });

  test('format toggle works', async ({ page }) => {
    // Start with compact code
    await setSource(page, '(module(func(result i32)i32.const 42))');

    // First click: prettify (safe, keeps comments)
    await page.click('button:has-text("prettify")');
    await page.waitForTimeout(100);

    let state = await getState(page);
    expect(state.sourceCode).toContain('\n'); // Should be prettified
    expect(state.prettified).toBe(true);

    // Button should now say "minify"
    await expect(page.locator('button:has-text("minify")')).toBeVisible();

    // Second click: minify
    await page.click('button:has-text("minify")');
    await page.waitForTimeout(100);

    state = await getState(page);
    expect(state.sourceCode).not.toContain('\n'); // Should be minified
    expect(state.prettified).toBe(false);
  });

  test('DOM updates reactively', async ({ page }) => {
    // This test verifies that sprae reactive bindings work
    // The binary and log elements should update when state changes

    // Wait for initial compilation
    await page.waitForTimeout(1000);

    // Check DOM has actual content (not just state)
    const binaryText = await page.locator('#binary').textContent();
    const logText = await page.locator('#log').textContent();

    expect(binaryText).toContain('00 61 73 6d'); // wasm magic in DOM
    expect(logText).toContain('Compiled in');
  });
});
