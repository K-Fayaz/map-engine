import { useEffect, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import "./HomeScreen.css";
import { useProjectStore } from "./projectStore";
import type { ProjectSummary } from "./project";

// The app's landing screen (roadmap.md Phase 2) -- shown whenever no
// project is open (App.tsx). Lists every project found under
// `$APPDATA/projects/` (self-healing: built by scanning disk each time,
// not a separate index that could drift out of sync) and lets the user
// create, open, rename, or permanently delete one.
export function HomeScreen() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const listProjects = useProjectStore((state) => state.listProjects);
  const createProject = useProjectStore((state) => state.createProject);
  const loadProject = useProjectStore((state) => state.loadProject);
  const renameProject = useProjectStore((state) => state.renameProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);

  const refresh = () => {
    listProjects()
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      // No naming modal -- the user renames from the editor's TopBar once
      // it's created, same "keep it minimal" call this app already makes
      // elsewhere (no in-app dialog component exists to reuse).
      await createProject("Untitled Project");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsCreating(false);
    }
    // On success App.tsx swaps to the editor once activeProjectId is set --
    // no navigation call needed here, and no need to reset isCreating since
    // this component unmounts.
  };

  const handleDelete = async (project: ProjectSummary) => {
    // Tauri's webview doesn't implement window.confirm as a real blocking
    // dialog (it silently resolves without showing anything) -- the dialog
    // plugin's own confirm() is the real native dialog.
    const shouldDelete = await confirm(
      `Delete "${project.name}" permanently? This cannot be undone.`,
      { title: "Delete project", okLabel: "Delete", cancelLabel: "Cancel", kind: "warning" },
    );
    if (!shouldDelete) return;
    try {
      await deleteProject(project.id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const commitRename = async (id: string) => {
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (trimmed) {
      try {
        await renameProject(id, trimmed);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  return (
    <div className="home-screen">
      <div className="home-screen-header">
        <h1 className="home-screen-title">Your Projects</h1>
        <button className="home-screen-new-button" onClick={handleCreate} disabled={isCreating}>
          {isCreating ? "Creating…" : "+ New Project"}
        </button>
      </div>

      {error && <div className="home-screen-error">{error}</div>}

      {projects === null ? (
        <div className="home-screen-status">Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="home-screen-status">
          No projects yet. Create your first one to get started.
        </div>
      ) : (
        <ul className="home-screen-list">
          {projects.map((project) => (
            <li key={project.id} className="home-screen-row">
              {renamingId === project.id ? (
                <div className="home-screen-row-open">
                  <input
                    className="home-screen-rename-input"
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(project.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(project.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                </div>
              ) : (
                <button
                  className="home-screen-row-open"
                  onClick={() => loadProject(project.id).catch((err) => setError(String(err)))}
                >
                  <span className="home-screen-row-name">{project.name}</span>
                  <span className="home-screen-row-updated">
                    {new Date(project.updatedAt).toLocaleString()}
                  </span>
                </button>
              )}
              <button
                className="home-screen-row-action"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(project.id);
                  setRenameDraft(project.name);
                }}
              >
                Rename
              </button>
              <button
                className="home-screen-row-action home-screen-row-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(project);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
