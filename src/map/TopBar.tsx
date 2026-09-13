import { useEffect, useState } from "react";
import "./TopBar.css";
import { confirmLeaveWithUnsavedChanges, useProjectStore } from "./projectStore";

// Shown only while a project is open (App.tsx), above the editor-layout
// grid -- the one way back to Home (Phase 2's project management) besides
// quitting the app, plus the explicit Save action (roadmap.md Phase 2: no
// autosave). Kept intentionally small: this app has no header/toolbar
// precedent to extend, so this is a new, minimal addition rather than a
// general app-chrome component.
export function TopBar() {
  const activeProjectName = useProjectStore((state) => state.activeProjectName);
  const isSaving = useProjectStore((state) => state.isSaving);
  const isDirty = useProjectStore((state) => state.isDirty);
  const error = useProjectStore((state) => state.error);
  const saveProject = useProjectStore((state) => state.saveProject);
  const renameProject = useProjectStore((state) => state.renameProject);
  const closeProject = useProjectStore((state) => state.closeProject);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(activeProjectName ?? "");

  useEffect(() => {
    if (!isEditingName) setNameDraft(activeProjectName ?? "");
  }, [activeProjectName, isEditingName]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveProject();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveProject]);

  const commitName = () => {
    setIsEditingName(false);
    const trimmed = nameDraft.trim();
    if (activeProjectId && trimmed && trimmed !== activeProjectName) {
      renameProject(activeProjectId, trimmed);
    } else {
      setNameDraft(activeProjectName ?? "");
    }
  };

  const handleBackToProjects = async () => {
    if (await confirmLeaveWithUnsavedChanges()) closeProject();
  };

  return (
    <div className="top-bar">
      <button className="top-bar-projects" onClick={handleBackToProjects} title="Back to Projects">
        ← Projects
      </button>
      {isEditingName ? (
        <input
          className="top-bar-name-input"
          value={nameDraft}
          autoFocus
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") {
              setNameDraft(activeProjectName ?? "");
              setIsEditingName(false);
            }
          }}
        />
      ) : (
        <button className="top-bar-name" onClick={() => setIsEditingName(true)} title="Rename project">
          {activeProjectName ?? "Untitled Project"}
          {isDirty && <span className="top-bar-dirty-dot" title="Unsaved changes" />}
        </button>
      )}
      <div className="top-bar-spacer" />
      {error && <span className="top-bar-error">{error}</span>}
      <button className="top-bar-save" onClick={() => saveProject()} disabled={isSaving}>
        {isSaving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
