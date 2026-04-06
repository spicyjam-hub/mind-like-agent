# Model with a Mind 🧠

An agentic AI system that thinks, remembers, and acts autonomously.

## The Agent Loop

```
observe → think → decide → act → reflect → repeat
```

| Phase | What happens |
|-------|-------------|
| **Observe** | Reads the goal, scans existing tasks and memory |
| **Think** | Calls Claude AI to reason about the goal |
| **Decide** | Determines what tasks to create and what action to take first |
| **Act** | Creates tasks, writes to memory |
| **Reflect** | Logs what happened, stores a reflection in memory |

## Features

- **Autonomy** — Enable autonomous mode and the agent self-initiates cycles every 15 seconds
- **Memory** — Every goal, task, and reflection is stored and passed back into future cycles
- **Decision Making** — Claude AI decides what tasks to create, their priority, and what to do first
- **Loop / Continuity** — Each cycle builds on prior memory, so the agent improves over time

## Getting Started

```bash
# 1. Clone the repo
git clone https://github.com/vsk-2005/model_with_mind.git
cd model_with_mind

# 2. Install dependencies
npm install

# 3. Run the dev server
npm run dev

# 4. Open http://localhost:3000
```

> **Note:** This app calls the Anthropic API via Claude's built-in API proxy when running inside claude.ai artifacts. To run locally or deploy standalone, you'll need an Anthropic API key — see the section below.

## Running Standalone (outside claude.ai)

Create a `.env` file:
```
VITE_ANTHROPIC_API_KEY=your_key_here
```

Then in `src/App.tsx`, update the fetch call to include your key:
```ts
headers: {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
}
```

## Project Structure

```
model_with_mind/
├── src/
│   ├── App.tsx        # Main agent — all logic lives here
│   ├── main.tsx       # React entry point
│   └── index.css      # Global styles
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Architecture

The agent is structured around 5 modules:

- **LLM (reasoning)** — Claude Sonnet via Anthropic API
- **Memory** — In-app state array, passed as context each cycle
- **Planner** — AI-generated task list with priorities and categories
- **Action module** — Creates tasks, toggles completion, writes logs
- **Loop** — Manual trigger + optional 15-second autonomous cycle

## Phase 1 Requirements ✅

- [x] Autonomy — agent takes actions without direct prompting
- [x] Memory — stores and reuses information across cycles
- [x] Decision Making — AI decides next steps, not just responds
- [x] Loop / Continuity — runs in multiple steps with state persistence

---

Built for the **Model with a Mind** project — Phase 1.
