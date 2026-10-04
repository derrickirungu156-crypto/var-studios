export type IncidentType = 'Penalty' | 'Offside' | 'Handball' | 'Red card' | 'Goal check'
export type OverlayType = 'Offside line' | 'Perspective line' | 'Arrow' | 'Circle' | 'Spotlight' | 'Zoom' | 'Text' | 'Player tag' | 'Lower third' | 'Verdict'
export type Aspect = '16:9' | '9:16'
export type TrackName = 'Footage' | 'Voiceover' | 'Music' | 'Graphics'

export interface MediaAsset {
  id: string
  name: string
  type: string
  size: number
  duration: number
  width: number
  height: number
  thumbnail?: string
  blob: Blob
}

export interface Incident {
  id: string
  type: IncidentType
  time: number
  note: string
}

export interface Overlay {
  id: string
  type: OverlayType
  time: number
  text: string
  x: number
  y: number
  color: string
}

export interface Caption {
  id: string
  start: number
  end: number
  text: string
}

export interface Project {
  id: string
  name: string
  aspect: Aspect
  assets: MediaAsset[]
  incidents: Incident[]
  overlays: Overlay[]
  captions: Caption[]
  script: string
  voiceover?: Blob
  voiceoverDuration?: number
  transcript: string
  youtubeUrl: string
  youtubeNotes: string
  duration: number
  playhead: number
  updatedAt: number
}

export interface EditorSnapshot {
  incidents: Incident[]
  overlays: Overlay[]
  captions: Caption[]
  script: string
  playhead: number
}
