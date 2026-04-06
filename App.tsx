import { useState, useRef, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
interface Task {
  id: number;
  title: string;
  priority: "high" | "medium" | "low";
  category: string;
  due: string | null;
  done: boolean;
  agent_generated: boolean;
  rationale: string;
  cycle: number;
}

interface Memory {
  type: "goal" | "observation" | "pattern" | "reflection" | "action";
  content: string;
  timestamp: string;
}

interface LogEntry {
  time: string;
  phase: string;
  text: string;
}

type Phase = "observe" | "think" | "decide" | "act" | "reflect" | "idle";
type Status = "idle" | "running" | "thinking";

// ── API ──────────────────────────────────────────────────────────────────────
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

async function callClaude(system: string, user: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: 1000, temperature: 0.7 },
        }),
      }
    );
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ts() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => n.toString().padStart(2, "0"))
    .join(":");
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memory, setMemory] = useState<Memory[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cycles, setCycles] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<Status>("idle");
  const [insight, setInsight] = useState(
    "Start the agent with a goal to see its live reasoning."
  );
  const [insightLoading, setInsightLoading] = useState(false);
  const [goal, setGoal] = useState("");
  const [activeTab, setActiveTab] = useState<"tasks" | "memory" | "log">("tasks");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [nextTaskId, setNextTaskId] = useState(1);

  const taskIdRef = useRef(1);
  const autonomousRef = useRef(false);
  const autonomousTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((p: string, text: string) => {
    setLogs((prev) => [...prev, { time: ts(), phase: p, text }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const addMemory = useCallback((entries: Memory[]) => {
    setMemory((prev) => [...prev, ...entries]);
  }, []);

  const runAgentCycle = useCallback(
    async (currentGoal: string, currentMemory: Memory[], currentTasks: Task[], cycleNum: number) => {
      setIsRunning(true);
      setStatus("running");

      try {
        // OBSERVE
        setPhase("observe");
        addLog("observe", `Goal: "${currentGoal}"`);
        addLog("observe", `Tasks: ${currentTasks.length} | Memory: ${currentMemory.length} | Done: ${currentTasks.filter((t) => t.done).length}`);
        setInsightLoading(true);
        setInsight("Observing environment...");
        await sleep(600);

        // THINK
        setPhase("think");
        setStatus("thinking");
        addLog("think", "Analyzing goal and memory context...");
        setInsight("Thinking...");

        const memCtx = currentMemory.slice(-8).map((m) => `[${m.type}] ${m.content}`).join("\n") || "No prior memory.";
        const taskCtx = currentTasks.map((t) => `${t.done ? "[DONE]" : "[PENDING]"} ${t.title} (${t.priority})`).join("\n") || "No existing tasks.";

        const raw = await callClaude(
          `You are an intelligent task-planning agent. Respond ONLY with valid JSON, no markdown or preamble.`,
          `Goal: "${currentGoal}"
Existing memory:\n${memCtx}
Current tasks:\n${taskCtx}
Cycle: ${cycleNum}

Respond with this JSON:
{
  "insight": "2-3 sentence reasoning about this goal",
  "tasks": [{"title":"...","priority":"high|medium|low","category":"...","due":"...or null","rationale":"..."}],
  "memory": [{"type":"goal|observation|pattern","content":"..."}],
  "next_action": "What to do first"
}
Rules: 4-7 specific actionable tasks. Only NEW tasks not already listed. Be practical.`
        );

        addLog("think", "LLM response received, parsing...");
        await sleep(400);

        let plan: {
          insight: string;
          tasks: { title: string; priority: string; category: string; due: string | null; rationale: string }[];
          memory: { type: string; content: string }[];
          next_action: string;
        };

        try {
          const clean = (raw || "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          plan = JSON.parse(clean);
        } catch {
          addLog("think", "Parse error — using structured fallback");
          plan = {
            insight: `I've analyzed your goal "${currentGoal}". I'll break it down into clear, actionable steps with appropriate priorities.`,
            tasks: [
              { title: `Research: ${currentGoal}`, priority: "high", category: "research", due: "Day 1", rationale: "Foundation" },
              { title: `Create a structured plan`, priority: "high", category: "planning", due: "Day 1", rationale: "Organization" },
              { title: `Take first action step`, priority: "high", category: "execution", due: "Day 2", rationale: "Momentum" },
              { title: `Track progress weekly`, priority: "medium", category: "review", due: "Weekly", rationale: "Feedback loop" },
              { title: `Build consistency`, priority: "medium", category: "habits", due: "Ongoing", rationale: "Long-term success" },
            ],
            memory: [{ type: "goal", content: `User wants to: ${currentGoal}` }],
            next_action: "Start with the highest priority task immediately",
          };
        }

        // DECIDE
        setPhase("decide");
        setStatus("running");
        addLog("decide", `Agent decided to create ${plan.tasks.length} tasks`);
        addLog("decide", `Next action: ${plan.next_action}`);
        setInsight("Making decisions...");
        await sleep(500);

        // ACT
        setPhase("act");
        addLog("act", "Executing decisions...");

        const newTasks: Task[] = plan.tasks.map((t) => {
          const id = taskIdRef.current++;
          return {
            id,
            title: t.title,
            priority: (t.priority as "high" | "medium" | "low") || "medium",
            category: t.category || "general",
            due: t.due || null,
            done: false,
            agent_generated: true,
            rationale: t.rationale || "",
            cycle: cycleNum,
          };
        });

        setNextTaskId(taskIdRef.current);
        setTasks((prev) => [...prev, ...newTasks]);
        newTasks.forEach((t) => addLog("act", `Task: "${t.title}" [${t.priority}]`));

        const newMems: Memory[] = [
          { type: "goal", content: `Cycle ${cycleNum}: Goal — "${currentGoal}"`, timestamp: ts() },
          ...(plan.memory || []).map((m) => ({ type: m.type as Memory["type"], content: m.content, timestamp: ts() })),
          { type: "pattern", content: `Cycle ${cycleNum}: Created ${newTasks.length} tasks`, timestamp: ts() },
        ];
        addMemory(newMems);
        addLog("act", `${newMems.length} memory entries stored`);
        await sleep(500);

        // REFLECT
        setPhase("reflect");
        addLog("reflect", "Generating post-cycle reflection...");
        setInsight("Reflecting...");
        await sleep(400);

        const reflectNote = `Cycle ${cycleNum} complete. Created ${newTasks.length} tasks. Memory: ${currentMemory.length + newMems.length} entries.`;
        addLog("reflect", reflectNote);
        addMemory([{ type: "reflection", content: reflectNote, timestamp: ts() }]);

        setInsightLoading(false);
        setInsight(plan.insight + (plan.next_action ? " Recommended: " + plan.next_action : ""));
        addLog("system", `─── Cycle ${cycleNum} complete ───`);

        setPhase("idle");
        setStatus(autonomousRef.current ? "running" : "idle");
      } catch (err) {
        addLog("system", "Error: " + String(err));
        setStatus("idle");
        setPhase("idle");
        setInsightLoading(false);
      } finally {
        setIsRunning(false);
      }
    },
    [addLog, addMemory]
  );

  const handleRunAgent = useCallback(async () => {
    if (!goal.trim() || isRunning) return;
    const newCycle = cycles + 1;
    setCycles(newCycle);
    setMemory((mem) => {
      setTasks((tsk) => {
        runAgentCycle(goal, mem, tsk, newCycle);
        return tsk;
      });
      return mem;
    });
  }, [goal, isRunning, cycles, runAgentCycle]);

  const toggleAutonomous = useCallback(() => {
    if (!goal.trim() && !autonomousMode) return;

    if (autonomousMode) {
      autonomousRef.current = false;
      setAutonomousMode(false);
      if (autonomousTimerRef.current) clearInterval(autonomousTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      setCountdown(null);
      addLog("system", "Autonomous mode stopped");
      setStatus("idle");
    } else {
      autonomousRef.current = true;
      setAutonomousMode(true);
      setStatus("running");
      addLog("system", "Autonomous mode started — cycling every 15s");

      let cd = 15;
      setCountdown(cd);
      countdownTimerRef.current = setInterval(() => {
        cd = cd <= 1 ? 15 : cd - 1;
        setCountdown(cd);
      }, 1000);

      autonomousTimerRef.current = setInterval(() => {
        if (!isRunning && autonomousRef.current) {
          const newCycle = cycles + 1;
          setCycles((c) => {
            const nc = c + 1;
            setMemory((mem) => {
              setTasks((tsk) => {
                runAgentCycle(goal, mem, tsk, nc);
                return tsk;
              });
              return mem;
            });
            return nc;
          });
        }
      }, 15000);
    }
  }, [autonomousMode, goal, isRunning, cycles, addLog, runAgentCycle]);

  const toggleTask = (id: number) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          addLog("act", `User toggled: "${t.title}" → ${t.done ? "pending" : "done"}`);
          addMemory([{ type: "action", content: `Task "${t.title}" marked ${t.done ? "pending" : "done"}`, timestamp: ts() }]);
          return { ...t, done: !t.done };
        }
        return t;
      })
    );
  };

  const doneTasks = tasks.filter((t) => t.done).length;
  const phaseOrder: Phase[] = ["observe", "think", "decide", "act", "reflect"];

  const phaseColor: Record<string, string> = {
    observe: "#7F77DD",
    think: "#BA7517",
    decide: "#1D9E75",
    act: "#185FA5",
    reflect: "#D85A30",
    system: "#888780",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e8e8f0", fontFamily: "'IBM Plex Mono', 'Fira Code', monospace" }}>
      {/* Google Font */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Header */}
        <div style={{ borderBottom: "1px solid #1e1e2e", paddingBottom: "1.5rem", marginBottom: "2rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <div style={{ fontSize: 28, lineHeight: 1 }}>&#129504;</div>
              <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "#e8e8f0" }}>
                model_with_mind
              </h1>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#1e1e2e", color: "#7F77DD", border: "1px solid #7F77DD", letterSpacing: "0.08em" }}>
                v1.0
              </span>
            </div>
            <p style={{ fontSize: 12, color: "#555570", letterSpacing: "0.04em" }}>
              observe → think → decide → act → reflect
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#555570" }}>cycle #{cycles}</span>
            <span style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 4,
              background: status === "idle" ? "#1a1a28" : status === "thinking" ? "#2a1f08" : "#0a2018",
              color: status === "idle" ? "#555570" : status === "thinking" ? "#BA7517" : "#1D9E75",
              border: `1px solid ${status === "idle" ? "#2a2a40" : status === "thinking" ? "#BA7517" : "#1D9E75"}`,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: status === "idle" ? "#555570" : status === "thinking" ? "#BA7517" : "#1D9E75",
                animation: status !== "idle" ? "pulse 1.2s infinite" : "none",
              }} />
              {status}
            </span>
          </div>
        </div>

        {/* Cycle visualizer */}
        <div style={{ background: "#0e0e1a", border: "1px solid #1e1e2e", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {phaseOrder.map((p, i) => (
            <span key={p} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 11, padding: "4px 12px", borderRadius: 4, fontWeight: 500,
                letterSpacing: "0.04em",
                background: phase === p ? phaseColor[p] + "22" : phaseOrder.indexOf(phase) > i && phase !== "idle" ? "#0f1e14" : "#1a1a28",
                color: phase === p ? phaseColor[p] : phaseOrder.indexOf(phase) > i && phase !== "idle" ? "#1D9E75" : "#333350",
                border: `1px solid ${phase === p ? phaseColor[p] : phaseOrder.indexOf(phase) > i && phase !== "idle" ? "#1D9E75" : "#1e1e2e"}`,
                transition: "all 0.3s",
              }}>
                {p}
              </span>
              {i < phaseOrder.length - 1 && <span style={{ color: "#333350", fontSize: 12 }}>→</span>}
            </span>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 11, color: "#555570" }}>
            <span>tasks: <strong style={{ color: "#e8e8f0" }}>{tasks.length}</strong></span>
            <span>done: <strong style={{ color: "#1D9E75" }}>{doneTasks}</strong></span>
            <span>memory: <strong style={{ color: "#7F77DD" }}>{memory.length}</strong></span>
          </div>
        </div>

        {/* Goal input */}
        <div style={{ background: "#0e0e1a", border: "1px solid #1e1e2e", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "1rem" }}>
          <div style={{ fontSize: 10, color: "#555570", letterSpacing: "0.08em", marginBottom: 10 }}>GIVE THE AGENT A GOAL</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRunAgent()}
              placeholder="e.g. Learn machine learning in 2 weeks"
              style={{
                flex: 1, background: "#14141f", border: "1px solid #2a2a40", borderRadius: 6,
                color: "#e8e8f0", fontSize: 13, padding: "8px 12px", fontFamily: "inherit",
                outline: "none",
              }}
            />
            <button
              onClick={handleRunAgent}
              disabled={isRunning || !goal.trim()}
              style={{
                background: isRunning ? "#1a1a28" : "#7F77DD", color: isRunning ? "#555570" : "#fff",
                border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13,
                fontFamily: "inherit", fontWeight: 500, cursor: isRunning ? "not-allowed" : "pointer",
                transition: "all 0.15s", whiteSpace: "nowrap",
              }}
            >
              {isRunning ? "running..." : "run agent →"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Learn Python from scratch", "Build a fitness habit in 30 days", "Prepare for a job interview", "Plan a weekend trip to Bangalore"].map((g) => (
              <button key={g} onClick={() => setGoal(g)} style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                background: "transparent", border: "1px solid #2a2a40", color: "#555570",
                fontFamily: "inherit", transition: "all 0.15s",
              }}
                onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.borderColor = "#7F77DD"; (e.target as HTMLButtonElement).style.color = "#7F77DD"; }}
                onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.borderColor = "#2a2a40"; (e.target as HTMLButtonElement).style.color = "#555570"; }}
              >{g}</button>
            ))}
          </div>
        </div>

        {/* AI Insight */}
        <div style={{ background: "#0e0e1a", border: "1px solid #1e1e2e", borderLeft: "3px solid #7F77DD", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "1rem" }}>
          <div style={{ fontSize: 10, color: "#555570", letterSpacing: "0.08em", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            AGENT INSIGHT
            <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: "#1a1628", color: "#7F77DD", border: "1px solid #7F77DD" }}>AI</span>
          </div>
          <p style={{ fontSize: 13, color: insightLoading ? "#555570" : "#c8c8d8", lineHeight: 1.7, margin: 0, fontStyle: insightLoading ? "italic" : "normal" }}>
            {insight}
          </p>
        </div>

        {/* Tabs */}
        <div style={{ background: "#0e0e1a", border: "1px solid #1e1e2e", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #1e1e2e", paddingBottom: 0 }}>
            {(["tasks", "memory", "log"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)} style={{
                fontSize: 12, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit",
                background: activeTab === t ? "#14141f" : "transparent",
                color: activeTab === t ? "#7F77DD" : "#555570",
                border: `1px solid ${activeTab === t ? "#2a2a40" : "transparent"}`,
                borderBottom: "none", borderRadius: "4px 4px 0 0", marginBottom: -1,
                transition: "all 0.15s",
              }}>
                {t} {t === "tasks" ? `(${tasks.length})` : t === "memory" ? `(${memory.length})` : `(${logs.length})`}
              </button>
            ))}
          </div>

          {activeTab === "tasks" && (
            <div>
              {tasks.length === 0 ? (
                <p style={{ fontSize: 12, color: "#333350", textAlign: "center", padding: "2rem 0" }}>no tasks yet — run the agent with a goal</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
                  {tasks.map((task) => (
                    <div key={task.id} onClick={() => toggleTask(task.id)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                      border: `1px solid ${task.priority === "high" ? "#D85A30" : task.priority === "medium" ? "#BA7517" : "#1D9E75"}22`,
                      borderLeft: `3px solid ${task.priority === "high" ? "#D85A30" : task.priority === "medium" ? "#BA7517" : "#1D9E75"}`,
                      borderRadius: 6, background: "#12121c", cursor: "pointer",
                      opacity: task.done ? 0.5 : 1, transition: "all 0.2s",
                    }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                        border: `2px solid ${task.done ? "#1D9E75" : "#333350"}`,
                        background: task.done ? "#1D9E75" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, color: "#fff",
                      }}>{task.done ? "✓" : ""}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "#c8c8d8", textDecoration: task.done ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {task.title}
                        </div>
                        <div style={{ fontSize: 11, color: "#555570", marginTop: 2, display: "flex", gap: 8 }}>
                          <span style={{
                            padding: "0 6px", borderRadius: 3,
                            background: task.priority === "high" ? "#2a1008" : task.priority === "medium" ? "#2a1a08" : "#0a2018",
                            color: task.priority === "high" ? "#D85A30" : task.priority === "medium" ? "#BA7517" : "#1D9E75",
                          }}>{task.priority}</span>
                          <span>{task.category}</span>
                          {task.due && <span>{task.due}</span>}
                          <span style={{ color: "#7F77DD" }}>cycle {task.cycle}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tasks.length > 0 && (
                <button onClick={() => setTasks([])} style={{
                  marginTop: 12, fontSize: 11, padding: "4px 10px", borderRadius: 4,
                  background: "transparent", border: "1px solid #D85A30", color: "#D85A30",
                  cursor: "pointer", fontFamily: "inherit",
                }}>clear all tasks</button>
              )}
            </div>
          )}

          {activeTab === "memory" && (
            <div>
              {memory.length === 0 ? (
                <p style={{ fontSize: 12, color: "#333350", textAlign: "center", padding: "2rem 0" }}>memory is empty</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
                  {[...memory].reverse().map((m, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", background: "#12121c", borderRadius: 6, alignItems: "flex-start" }}>
                      <span style={{
                        fontSize: 10, padding: "2px 6px", borderRadius: 3, flexShrink: 0,
                        background: "#1a1628", color: "#7F77DD", border: "1px solid #7F77DD33",
                      }}>{m.type}</span>
                      <span style={{ fontSize: 12, color: "#888898", lineHeight: 1.5 }}>{m.content}</span>
                    </div>
                  ))}
                </div>
              )}
              {memory.length > 0 && (
                <button onClick={() => setMemory([])} style={{
                  marginTop: 12, fontSize: 11, padding: "4px 10px", borderRadius: 4,
                  background: "transparent", border: "1px solid #D85A30", color: "#D85A30",
                  cursor: "pointer", fontFamily: "inherit",
                }}>clear memory</button>
              )}
            </div>
          )}

          {activeTab === "log" && (
            <div>
              <div style={{ height: 280, overflowY: "auto", background: "#0a0a14", borderRadius: 6, padding: 10 }}>
                {logs.length === 0 && <p style={{ fontSize: 11, color: "#333350" }}>no log entries yet</p>}
                {logs.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 11, lineHeight: 1.6, alignItems: "flex-start" }}>
                    <span style={{ color: "#333350", minWidth: 56, fontFamily: "inherit" }}>{l.time}</span>
                    <span style={{ minWidth: 68, color: phaseColor[l.phase.toLowerCase()] || "#555570", fontWeight: 500 }}>[{l.phase}]</span>
                    <span style={{ color: "#888898" }}>{l.text}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
              {logs.length > 0 && (
                <button onClick={() => setLogs([])} style={{
                  marginTop: 8, fontSize: 11, padding: "4px 10px", borderRadius: 4,
                  background: "transparent", border: "1px solid #2a2a40", color: "#555570",
                  cursor: "pointer", fontFamily: "inherit",
                }}>clear log</button>
              )}
            </div>
          )}
        </div>

        {/* Autonomous mode */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={toggleAutonomous}
            disabled={!goal.trim() && !autonomousMode}
            style={{
              fontSize: 12, padding: "8px 18px", borderRadius: 6, cursor: goal.trim() || autonomousMode ? "pointer" : "not-allowed",
              background: autonomousMode ? "#2a0808" : "#0a2018",
              color: autonomousMode ? "#D85A30" : "#1D9E75",
              border: `1px solid ${autonomousMode ? "#D85A30" : "#1D9E75"}`,
              fontFamily: "inherit", fontWeight: 500, transition: "all 0.15s",
            }}
          >
            {autonomousMode ? "⏹ stop autonomous mode" : "▶ start autonomous mode"}
          </button>
          <span style={{ fontSize: 11, color: "#333350" }}>agent will self-initiate cycles every 15 seconds</span>
          {countdown !== null && autonomousMode && (
            <span style={{ fontSize: 11, color: "#7F77DD" }}>next cycle in {countdown}s</span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        input:focus { border-color: #7F77DD !important; outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a14; }
        ::-webkit-scrollbar-thumb { background: #2a2a40; border-radius: 2px; }
      `}</style>
    </div>
  );
}
