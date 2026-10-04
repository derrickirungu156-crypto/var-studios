import { create } from 'zustand'
import { db, saveProject } from './db'
import type { EditorSnapshot, Project } from '../types'

const emptyProject = (): Project => ({
  id: crypto.randomUUID(),
  name: 'Untitled VAR analysis',
  aspect: '16:9',
  assets: [],
  incidents: [],
  overlays: [],
  captions: [],
  script: '',
  voiceover: undefined,
  voiceoverDuration: 0,
  transcript: '',
  youtubeUrl: '',
  youtubeNotes: '',
  duration: 0,
  playhead: 0,
  updatedAt: Date.now(),
})

interface Store {
  project: Project
  projectList: Project[]
  selectedAssetId: string | null
  selectedIncidentId: string | null
  selectedOverlayId: string | null
  isDirty: boolean
  undoStack: EditorSnapshot[]
  redoStack: EditorSnapshot[]
  setProject: (project: Project) => void
  refreshProjects: () => Promise<void>
  update: (patch: Partial<Project>) => void
  addAsset: (asset: Project['assets'][number]) => void
  selectAsset: (id: string | null) => void
  save: () => Promise<void>
  undo: () => void
  redo: () => void
  snapshot: () => void
}

const snapshotOf = (project: Project): EditorSnapshot => ({
  incidents: structuredClone(project.incidents),
  overlays: structuredClone(project.overlays),
  captions: structuredClone(project.captions),
  script: project.script,
  playhead: project.playhead,
})

export const useEditor = create<Store>((set, get) => ({
  project: emptyProject(),
  projectList: [],
  selectedAssetId: null,
  selectedIncidentId: null,
  selectedOverlayId: null,
  isDirty: false,
  undoStack: [],
  redoStack: [],
  setProject: project => set({ project, selectedAssetId: project.assets[0]?.id ?? null, selectedIncidentId: null, selectedOverlayId: null, isDirty: false, undoStack: [], redoStack: [] }),
  refreshProjects: async () => set({ projectList: await db.projects.orderBy('updatedAt').reverse().toArray() }),
  update: patch => set(state => ({ project: { ...state.project, ...patch }, isDirty: true })),
  addAsset: asset => set(state => ({
    project: { ...state.project, assets: [...state.project.assets, asset], duration: Math.max(state.project.duration, asset.duration), updatedAt: Date.now() },
    selectedAssetId: asset.id,
    isDirty: true,
  })),
  selectAsset: id => set({ selectedAssetId: id }),
  snapshot: () => set(state => ({ undoStack: [...state.undoStack.slice(-39), snapshotOf(state.project)], redoStack: [] })),
  undo: () => set(state => {
    const previous = state.undoStack[state.undoStack.length - 1]
    if (!previous) return {}
    const current = snapshotOf(state.project)
    return {
      project: { ...state.project, ...previous },
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, current],
      isDirty: true,
    }
  }),
  redo: () => set(state => {
    const next = state.redoStack[state.redoStack.length - 1]
    if (!next) return {}
    return {
      project: { ...state.project, ...next },
      undoStack: [...state.undoStack, snapshotOf(state.project)],
      redoStack: state.redoStack.slice(0, -1),
      isDirty: true,
    }
  }),
  save: async () => {
    const project = get().project
    await saveProject(project)
    const projectList = await db.projects.orderBy('updatedAt').reverse().toArray()
    set({ projectList, ...(get().project === project ? { isDirty: false } : {}) })
  },
}))
