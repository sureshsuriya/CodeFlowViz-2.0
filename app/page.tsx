import CodeEditor from '@/components/CodeEditor';

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CodeFlowViz 2.0</p>
          <h1>Execution Cockpit</h1>
        </div>
        <div className="status">Void Theme · Monaco Ready</div>
      </header>

      <section className="workspace">
        <aside className="panel left">
          <h2>Flow Controls</h2>
          <button>Run</button>
          <button>Step Into</button>
          <button>Step Over</button>
          <button>Reset</button>
        </aside>

        <section className="panel editor">
          <div className="panelTitle">Code Editor</div>
          <div className="editorWrap">
            <CodeEditor />
          </div>
        </section>

        <aside className="panel right">
          <h2>Runtime Introspection</h2>
          <p>Variable watch and call stack panels will appear in Phase 2.</p>
        </aside>
      </section>
    </main>
  );
}
