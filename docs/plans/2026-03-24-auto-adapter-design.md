# Auto Adapter — LLM-Driven Adapter Generation System

## Summary

Fuse Web Access's generalization capability with OpenCLI's stable adapter approach:
- **First visit**: LLM explores site, generates TypeScript adapter interactively
- **Subsequent visits**: Direct adapter execution, no LLM needed
- **Monitoring**: Cron-based health checks, notify user on breakage

## Decisions

| Question | Decision |
|----------|----------|
| User | Personal use, integrated into forked opencli |
| Trigger | Phase 1: explicit `opencli generate`, Phase 2: auto-fallback |
| LLM | OpenAI API (`$OPENAI_API_KEY`) |
| Monitoring | Cron-based scheduled checks |
| On failure | Notify user (no auto-regenerate) |
| Output format | TypeScript only |
| Command discovery | Interactive — LLM suggests, user confirms |
| Safety | Execute full flow, pause before irreversible actions (payment) |

## Architecture

```
opencli generate https://pokemoncenter-online.com
        │
        ▼
  ┌─────────────────┐
  │  1. Site Explore │  Chrome extension opens site, captures DOM snapshot
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  2. LLM Analyze  │  OpenAI analyzes structure, suggests command list
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  3. User Confirm │  Terminal interaction: user reviews/edits command list
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  4. Code Gen     │  LLM generates TypeScript adapter for each command
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │  5. Build & Reg  │  esbuild compile → ~/.opencli/plugins/auto-<site>/
  └────────┬────────┘
           ▼
  opencli list  → shows new commands ✅
  opencli <site> <command> → direct use ✅
```

## Storage

Generated adapters live in the plugin directory:

```
~/.opencli/plugins/auto-pokemoncenter/
  package.json
  src/
    search.ts        → pokemoncenter search [cookie]
    add-cart.ts      → pokemoncenter add-cart [cookie]
    buy.ts           → pokemoncenter buy [cookie]
  dist/
    search.js
    add-cart.js
    buy.js
```

- Prefix `auto-` distinguishes AI-generated from hand-written adapters
- Uses OpenCLI's existing `discoverPlugins()` mechanism — zero changes to core
- `opencli list` auto-discovers on startup

## Generate Command

### Usage

```bash
# Phase 1: Explicit generation
opencli generate https://pokemoncenter-online.com

# With initial hints
opencli generate https://pokemoncenter-online.com --goal "search products, add to cart, buy"
```

### Interactive Flow

```
$ opencli generate https://pokemoncenter-online.com

🔍 Exploring site...
   Opening https://pokemoncenter-online.com in Chrome...
   Capturing page structure...

🤖 Analyzing with OpenAI...
   Detected: e-commerce site (Pokemon Center Online)

📋 Suggested commands:

  1. search    — Search products by keyword
  2. detail    — View product details
  3. add-cart  — Add product to cart
  4. cart      — View current cart
  5. buy       — Complete checkout flow (pauses before payment)

  [Enter] Accept all
  [e]     Edit (add/remove/rename)
  [q]     Quit

> e
Remove command numbers (comma-separated): 4
Add command (name — description): wishlist — Add product to wishlist

Updated list:
  1. search    — Search products by keyword
  2. detail    — View product details
  3. add-cart  — Add product to cart
  4. buy       — Complete checkout flow (pauses before payment)
  5. wishlist  — Add product to wishlist

  [Enter] Confirm and generate
>

⚙️  Generating TypeScript adapters...
   ✅ search.ts
   ✅ detail.ts
   ✅ add-cart.ts
   ✅ buy.ts
   ✅ wishlist.ts

📦 Compiling...
   ✅ Plugin installed: auto-pokemoncenter (5 commands)

Done! Try: opencli pokemoncenter search "pikachu"
```

## LLM Integration

### Provider

OpenAI API via `$OPENAI_API_KEY` (already set globally).

### Prompts

**Step 1 — Analyze site and suggest commands:**

Input to LLM:
- URL and domain
- DOM snapshot (trimmed: interactive elements, navigation, key content areas)
- Page title, meta description
- Optional `--goal` hint from user

Output: JSON array of suggested commands with name, description, strategy, required args.

**Step 2 — Generate TypeScript adapter:**

Input to LLM:
- Confirmed command spec (name, description, args, columns)
- DOM snapshot of relevant page sections
- OpenCLI adapter examples (2-3 existing adapters as few-shot)
- IPage API reference (goto, evaluate, click, wait, etc.)

Output: Complete TypeScript source file, following OpenCLI conventions.

### Token Management

- DOM snapshots truncated to essential interactive elements (< 4K tokens)
- Few-shot examples kept minimal (1 YAML + 1 TS example)
- One LLM call per step (analyze → one call, generate per command → one call each)

## Safety: Pause Before Irreversible Actions

No commands are blocked. All commands execute fully, but **pause before the final irreversible step**.

### How It Works

The LLM generation prompt instructs: for any flow involving payment, deletion, or permanent state change, the generated code must:

1. Execute all preparatory steps (search, select, fill forms, navigate to checkout)
2. **Stop before clicking the final submit/pay button**
3. Print a message: `⚠️ Paused before [action]. Browser window kept open for manual completion.`
4. Return without closing the browser tab

### Detection Keywords

The LLM is instructed to identify final-step buttons by text content:

- Payment: 支付, 付款, 确认订单, place order, submit order, pay now, checkout, complete purchase
- Deletion: 确认删除, delete permanently, remove account
- Subscription: 确认订阅, subscribe now, confirm subscription

### Generated Code Pattern

```typescript
func: async (page, kwargs) => {
  // ... all steps up to final page ...

  // Check for payment/submit button — DO NOT CLICK
  const finalBtn = await page.evaluate(`
    (() => {
      const btns = document.querySelectorAll('button, [role="button"], a[class*="submit"]');
      const keywords = ['支付','付款','确認','place order','pay now','submit order','checkout'];
      for (const btn of btns) {
        const text = (btn.textContent || '').toLowerCase();
        if (keywords.some(k => text.includes(k))) {
          return { found: true, text: btn.textContent.trim() };
        }
      }
      return { found: false };
    })()
  `);

  if (finalBtn.found) {
    return [{
      status: '⚠️ paused',
      message: `Stopped before "${finalBtn.text}". Browser window kept open — complete manually.`,
    }];
  }

  // ... click submit if no dangerous button detected ...
}
```

## Health Check System

### Commands

```bash
# Manual check — run all auto-generated adapters
opencli adapter check

# Check specific site
opencli adapter check pokemoncenter

# Register daily cron
opencli adapter check --cron "0 9 * * *"

# List check status
opencli adapter status
```

### Check Logic

For each adapter in `~/.opencli/plugins/auto-*/`:

1. Execute with safe test args (read-only commands only, skip write commands)
2. Validate: non-empty result, expected column structure, no error
3. Update metadata: `last_check`, `last_success`, `status` (ok/broken/skipped)

### Metadata File

```json
// ~/.opencli/plugins/auto-pokemoncenter/adapter-meta.json
{
  "generated_at": "2026-03-24T10:00:00Z",
  "generated_by": "gpt-4o",
  "url": "https://pokemoncenter-online.com",
  "commands": ["search", "detail", "add-cart", "buy", "wishlist"],
  "checks": {
    "search": { "last_check": "2026-03-25T09:00:00Z", "status": "ok" },
    "detail": { "last_check": "2026-03-25T09:00:00Z", "status": "ok" },
    "add-cart": { "last_check": null, "status": "skipped", "reason": "write command" },
    "buy": { "last_check": null, "status": "skipped", "reason": "write command" },
    "wishlist": { "last_check": null, "status": "skipped", "reason": "write command" }
  }
}
```

### Notification

When a check fails:
- Terminal: colored output `❌ pokemoncenter/search BROKEN — empty result`
- Optional: Telegram notification via Saved Messages (using ghost-os, per user's setup)

## Phase 2: Auto-Fallback

When a user runs a command for an unregistered site:

```bash
opencli pokemoncenter search "pikachu"
# → "pokemoncenter" not found. Generate adapter? [Y/n]
```

Implementation: hook into the command-not-found path in `src/cli.ts`, prompt user, then run the generate flow.

## Implementation Plan

### Phase 1 — Core Generate (MVP)

1. `src/clis/adapter/generate.ts` — the generate command
2. `src/adapter-gen/explorer.ts` — site exploration via Chrome extension
3. `src/adapter-gen/analyzer.ts` — OpenAI API integration for analysis
4. `src/adapter-gen/codegen.ts` — OpenAI API integration for TS generation
5. `src/adapter-gen/builder.ts` — esbuild compile + plugin registration
6. `src/adapter-gen/prompts.ts` — prompt templates for LLM

### Phase 2 — Health Checks

7. `src/clis/adapter/check.ts` — check command
8. `src/clis/adapter/status.ts` — status display
9. `src/adapter-gen/meta.ts` — metadata read/write
10. Cron integration

### Phase 3 — Auto-Fallback

11. Hook into command-not-found in `src/cli.ts`
12. Auto-trigger generate flow with confirmation
