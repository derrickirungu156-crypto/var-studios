import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react'
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, BadgeCheck, Captions, Check,
  ChevronDown, Circle, Clapperboard, Clock3, Cloud, Download, FileArchive, Film, Flag,
  FolderOpen, Gauge, HelpCircle, Image, Keyboard, Languages, Layers,
  Link2, LoaderCircle, LockKeyhole, Mic2, Minus, MoreHorizontal, Move, MousePointer2,
  Pause, PenLine, Play, Plus, Redo2, Scissors, Settings, ShieldCheck,
  Sparkles, Trash2, Undo2, Upload, Volume2, WandSparkles, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { useEditor } from './lib/store'
import { saveProject } from './lib/db'
import { askAI, formatTime, makeScriptPrompt, scriptToCaptions } from './lib/ai'
import { captionsToSrt, downloadBlob, downloadText, projectSummary, renderVideo } from './lib/export'
import { authorizeYouTube, getConnectedYouTubeChannel, preloadYouTubeIdentity, revokeYouTubeToken, uploadToYouTube } from './lib/youtube'
import type { IncidentType, Overlay, OverlayType, Project, TrackName } from './types'

const incidentTypes: IncidentType[] = ['Penalty', 'Offside', 'Handball', 'Red card', 'Goal check']
const overlayTypes: OverlayType[] = ['Offside line', 'Perspective line', 'Arrow', 'Circle', 'Spotlight', 'Zoom', 'Text', 'Player tag', 'Lower third', 'Verdict']
const toolIcons = [Flag, PenLine, Move, Circle, Activity, ZoomIn, Captions, BadgeCheck, Clapperboard, Check]
const toolColors: Record<IncidentType, string> = { Penalty: '#f1b850', Offside: '#7fa9ff', Handball: '#f27a72', 'Red card': '#ff5b55', 'Goal check': '#a78bfa' }
const newId = () => crypto.randomUUID()
const kokoroVoices = ['af_heart', 'af_bella', 'af_nicole', 'am_adam', 'am_michael', 'bf_emma', 'bm_george'] as const
type KokoroVoice = typeof kokoroVoices[number]
type StudioSettings = {
  provider: 'Gemini' | 'Groq'
  apiKey: string
  style: string
  language: string
  voice: KokoroVoice
  speed: number
  pitch: number
  youtubeClientId: string
}
const defaultSettings: StudioSettings = { provider: 'Gemini', apiKey: '', style: 'Neutral analyst', language: 'English', voice: 'af_heart', speed: 1, pitch: 1, youtubeClientId: '' }
const initialSettings = (): StudioSettings => {
  try {
    const stored = JSON.parse(localStorage.getItem('var-studio-settings') || '{}') as Partial<StudioSettings>
    return {
      provider: stored.provider === 'Groq' ? 'Groq' : 'Gemini',
      apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
      style: typeof stored.style === 'string' ? stored.style : defaultSettings.style,
      language: typeof stored.language === 'string' ? stored.language : defaultSettings.language,
      voice: kokoroVoices.includes(stored.voice as KokoroVoice) ? stored.voice as KokoroVoice : defaultSettings.voice,
      speed: typeof stored.speed === 'number' && stored.speed >= .6 && stored.speed <= 1.5 ? stored.speed : defaultSettings.speed,
      pitch: typeof stored.pitch === 'number' && stored.pitch >= .6 && stored.pitch <= 1.5 ? stored.pitch : defaultSettings.pitch,
      youtubeClientId: typeof stored.youtubeClientId === 'string' ? stored.youtubeClientId : '',
    }
  } catch {
    return defaultSettings
  }
}

function App() {
  const project = useEditor(state => state.project)
  const projectList = useEditor(state => state.projectList)
  const selectedAssetId = useEditor(state => state.selectedAssetId)
  const selectedIncidentId = useEditor(state => state.selectedIncidentId)
  const selectedOverlayId = useEditor(state => state.selectedOverlayId)
  const isDirty = useEditor(state => state.isDirty)
  const update = useEditor(state => state.update)
  const addAsset = useEditor(state => state.addAsset)
  const snapshot = useEditor(state => state.snapshot)
  const setProject = useEditor(state => state.setProject)
  const refreshProjects = useEditor(state => state.refreshProjects)
  const save = useEditor(state => state.save)
  const undo = useEditor(state => state.undo)
  const redo = useEditor(state => state.redo)

  const [settings, setSettings] = useState<StudioSettings>(initialSettings)
  const [activeModal, setActiveModal] = useState<'settings' | 'export' | 'help' | null>(null)
  const [activeTool, setActiveTool] = useState<OverlayType | null>(null)
  const [dragging, setDragging] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [quality, setQuality] = useState<'Draft' | 'Full'>('Draft')
  const [voicePreview, setVoicePreview] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [projectMenu, setProjectMenu] = useState(false)
  const [renderCancel, setRenderCancel] = useState<(() => void) | null>(null)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [showWelcome, setShowWelcome] = useState(!localStorage.getItem('var-studio-welcomed'))
  const [transcriptionReady, setTranscriptionReady] = useState(false)
  const [draggingOverlayId, setDraggingOverlayId] = useState<string | null>(null)
  const [renderedVideo, setRenderedVideo] = useState<Blob | null>(null)
  const [renderedVideoAssetId, setRenderedVideoAssetId] = useState<string | null>(null)
  const [renderedVideoAspect, setRenderedVideoAspect] = useState<Project['aspect'] | null>(null)
  const [youtubeToken, setYoutubeToken] = useState('')
  const [youtubeChannel, setYoutubeChannel] = useState('')
  const [youtubeIdentityReady, setYoutubeIdentityReady] = useState(false)
  const [youtubePrivacy, setYoutubePrivacy] = useState<'private' | 'unlisted' | 'public'>('private')
  const [youtubeTitle, setYoutubeTitle] = useState(project.name)
  const [youtubeDescription, setYoutubeDescription] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const uploadController = useRef<AbortController | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timelineRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const renderCancelled = useRef(false)

  const selectedAsset = project.assets.find(asset => asset.id === selectedAssetId) ?? project.assets[0]
  const renderedVideoIsCurrent = Boolean(renderedVideo && renderedVideoAssetId === selectedAsset?.id && renderedVideoAspect === project.aspect)
  const selectedIncident = project.incidents.find(item => item.id === selectedIncidentId)
  const selectedOverlay = project.overlays.find(item => item.id === selectedOverlayId)
  const videoUrl = useMemo(() => selectedAsset ? URL.createObjectURL(selectedAsset.blob) : '', [selectedAsset?.id, selectedAsset?.blob])
  const voiceoverUrl = useMemo(() => project.voiceover ? URL.createObjectURL(project.voiceover) : '', [project.voiceover])
  const shortTooLong = project.aspect === '9:16' && project.duration > 60

  useEffect(() => { void refreshProjects() }, [refreshProjects])
  useEffect(() => {
    if (activeModal !== 'settings') return
    let current = true
    void preloadYouTubeIdentity().then(() => {
      if (current) setYoutubeIdentityReady(true)
    }).catch(caught => {
      if (current) setError(caught instanceof Error ? caught.message : 'Could not load Google sign-in.')
    })
    return () => { current = false }
  }, [activeModal])
  useEffect(() => {
    localStorage.setItem('var-studio-settings', JSON.stringify(settings))
  }, [settings])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  useEffect(() => () => { if (voiceoverUrl) URL.revokeObjectURL(voiceoverUrl) }, [voiceoverUrl])
  useEffect(() => {
    if (!isDirty) return
    const timer = window.setTimeout(() => { void save().catch(caught => setError(caught instanceof Error ? `Autosave failed: ${caught.message}` : 'Could not autosave project.')) }, 1200)
    return () => window.clearTimeout(timer)
  }, [project, isDirty, save])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (playing) void video.play().catch(caught => setError(caught instanceof Error ? caught.message : 'Video playback failed.'))
    else video.pause()
  }, [playing, videoUrl])

  const seek = useCallback((time: number) => {
    const bounded = Math.max(0, Math.min(project.duration || Number.MAX_SAFE_INTEGER, time))
    update({ playhead: bounded })
    if (videoRef.current) videoRef.current.currentTime = bounded
  }, [project.duration, update])

  const addIncident = (type: IncidentType, time = project.playhead) => {
    snapshot()
    const incident = { id: newId(), type, time, note: '' }
    update({ incidents: [...project.incidents, incident].sort((a, b) => a.time - b.time) })
    useEditor.setState({ selectedIncidentId: incident.id, selectedOverlayId: null })
  }

  const addOverlay = (type: OverlayType, point?: { x: number; y: number }) => {
    snapshot()
    const overlay: Overlay = {
      id: newId(), type, time: project.playhead,
      text: type === 'Verdict' ? 'CORRECT DECISION' : type === 'Player tag' ? 'PLAYER NAME' : type === 'Lower third' ? 'VAR REVIEW • MATCH ANALYSIS' : type === 'Text' ? 'Analysis note' : '',
      x: point?.x ?? 50, y: point?.y ?? (type === 'Lower third' ? 82 : 38),
      color: type === 'Offside line' || type === 'Perspective line' ? '#ff5555' : '#9fea63',
    }
    update({ overlays: [...project.overlays, overlay] })
    useEditor.setState({ selectedOverlayId: overlay.id, selectedIncidentId: null })
    setActiveTool(null)
  }

  const handleFiles = async (files: FileList | File[]) => {
    setError('')
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('video/')) {
        setError(`${file.name} is not a video file. Choose MP4, MOV, or WebM footage.`)
        continue
      }
      try {
        const metadata = await readVideoMetadata(file)
        addAsset({ id: newId(), name: file.name, type: file.type, size: file.size, blob: file, ...metadata })
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `Could not read ${file.name}.`)
      }
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void handleFiles(event.dataTransfer.files)
  }

  const onStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!activeTool) return
    const rect = event.currentTarget.getBoundingClientRect()
    addOverlay(activeTool, { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 })
  }

  const onOverlayPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    const hit = [...project.overlays].reverse().find(item =>
      item.time <= project.playhead && item.time >= project.playhead - 12
      && Math.abs(item.x - x) < 12 && Math.abs(item.y - y) < 14,
    )
    if (hit) {
      event.stopPropagation()
      snapshot()
      useEditor.setState({ selectedOverlayId: hit.id, selectedIncidentId: null })
      setDraggingOverlayId(hit.id)
      event.currentTarget.setPointerCapture(event.pointerId)
    } else if (activeTool) {
      event.stopPropagation()
      addOverlay(activeTool, { x, y })
    }
  }

  const onOverlayPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draggingOverlayId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
    update({ overlays: project.overlays.map(item => item.id === draggingOverlayId ? { ...item, x, y } : item) })
  }

  const addMarkerAtPlayhead = (event: ChangeEvent<HTMLSelectElement>) => {
    const type = event.target.value as IncidentType
    if (incidentTypes.includes(type)) addIncident(type)
    event.target.value = ''
  }

  const saveProjectNow = async () => {
    try {
      await save()
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? `Save failed: ${caught.message}` : 'Could not save project to this browser.')
    }
  }

  const updateIncident = (id: string, patch: Partial<Project['incidents'][number]>) => {
    snapshot()
    update({ incidents: project.incidents.map(item => item.id === id ? { ...item, ...patch } : item) })
  }

  const updateSelectedOverlay = (patch: Partial<Overlay>) => {
    if (!selectedOverlay) return
    snapshot()
    update({ overlays: project.overlays.map(item => item.id === selectedOverlay.id ? { ...item, ...patch } : item) })
  }

  const removeSelected = () => {
    if (selectedIncident) {
      snapshot()
      update({ incidents: project.incidents.filter(item => item.id !== selectedIncident.id) })
      useEditor.setState({ selectedIncidentId: null })
    } else if (selectedOverlay) {
      snapshot()
      update({ overlays: project.overlays.filter(item => item.id !== selectedOverlay.id) })
      useEditor.setState({ selectedOverlayId: null })
    }
  }

  const splitAtPlayhead = () => {
    if (!selectedAsset || !project.duration || project.playhead <= 0 || project.playhead >= project.duration) {
      setError('Move the playhead inside a video clip before splitting.')
      return
    }
    snapshot()
    const first = structuredClone(selectedAsset)
    const second = structuredClone(selectedAsset)
    first.id = newId()
    first.name = `${selectedAsset.name} · Part 1`
    first.duration = project.playhead
    second.id = newId()
    second.name = `${selectedAsset.name} · Part 2`
    second.duration = project.duration - project.playhead
    update({ assets: [...project.assets.filter(item => item.id !== selectedAsset.id), first, second] })
    useEditor.setState({ selectedAssetId: first.id })
    setError('Split added two editable timeline segments. Source files remain unchanged.')
  }

  const createSample = async () => {
    const sample: Project = {
      id: newId(), name: 'The 89th-minute offside call', aspect: '16:9', assets: [], duration: 95, playhead: 57,
      incidents: [{ id: newId(), type: 'Offside', time: 57, note: 'Tight offside decision before the goal. Draw a line through the last defender; verify the frame at the moment the pass is played.' }],
      overlays: [], captions: [], script: 'The goal looked certain, but the assistant referee spotted a possible offside. Freeze the frame at the moment the pass is played. The defender’s position is the key reference point. The decision stands only if the attacker is beyond the second-last opponent when the ball is released.',
      transcript: '', youtubeUrl: '', youtubeNotes: 'Sample workspace — import footage to preview and render. No match footage is included.',
      updatedAt: Date.now(),
    }
    setProject(sample)
    try { await saveProject(sample); await refreshProjects() } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save sample project.') }
    setShowWelcome(false)
    localStorage.setItem('var-studio-welcomed', '1')
  }

  const createProject = async () => {
    const fresh: Project = {
      id: newId(), name: 'Untitled VAR analysis', aspect: '16:9', assets: [], incidents: [], overlays: [], captions: [], script: '',
      transcript: '', youtubeUrl: '', youtubeNotes: '', duration: 0, playhead: 0, updatedAt: Date.now(),
    }
    setProject(fresh)
    setProjectMenu(false)
  }

  const generateScript = async () => {
    setBusy('Writing analysis script')
    setError('')
    try {
      const text = await askAI(settings, makeScriptPrompt({ incidents: project.incidents, transcript: project.transcript, style: settings.style, language: settings.language }))
      snapshot()
      update({ script: text })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not generate script.')
    } finally { setBusy('') }
  }

  const aiAction = async (task: 'titles' | 'description' | 'hashtags' | 'thumbnail' | 'translation') => {
    const prompts = {
      titles: `Suggest 8 accurate, engaging YouTube titles for this football VAR analysis. Avoid asserting an outcome that is not in the notes. Notes: ${projectSummary(project)}`,
      description: `Write a YouTube description for this football VAR analysis. Include incident chapters with timestamps and a rights-respecting factual tone. Project: ${projectSummary(project)}`,
      hashtags: `Suggest 12 relevant football VAR analysis hashtags, one line. Context: ${projectSummary(project)}`,
      thumbnail: `Suggest 3 clear thumbnail frames and concise text treatments based only on this analysis. Notes: ${projectSummary(project)}`,
      translation: `Translate these captions to ${settings.language}. Preserve each timestamp and output one line per caption as [start] --> [end] text. Captions:\n${project.captions.map(cap => `[${formatTime(cap.start)}] --> [${formatTime(cap.end)}] ${cap.text}`).join('\n')}`,
    }
    setBusy(`Generating ${task}`)
    setError('')
    try {
      const result = await askAI(settings, prompts[task])
      if (task === 'translation') {
        const translated = result.split('\n').map(line => {
          const match = line.match(/^\[(\d+:\d+)\]\s*-->\s*\[(\d+:\d+)\]\s*(.*)$/)
          if (!match) return null
          const toSeconds = (value: string) => value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
          return { id: newId(), start: toSeconds(match[1]), end: toSeconds(match[2]), text: match[3] }
        }).filter((item): item is NonNullable<typeof item> => item !== null)
        if (translated.length) { snapshot(); update({ captions: translated }) }
        else setError('The translation response did not preserve the expected timestamp format. Review the AI result: ' + result)
      } else {
        setAiOutput({ title: task, text: result })
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not generate ${task}.`) }
    finally { setBusy('') }
  }

  const [aiOutput, setAiOutput] = useState<{ title: string; text: string } | null>(null)

  const generateVoice = async () => {
    const text = project.script.trim()
    if (!text) { setError('Write or generate a script before creating a voiceover.'); return }
    setBusy('Loading local Kokoro voice model (first download is large)')
    setError('')
    try {
      const { KokoroTTS } = await import('kokoro-js')
      const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8' })
      setBusy('Generating voiceover')
      const audio = await tts.generate(text, { voice: settings.voice })
      const blob = audio.toBlob()
      update({ voiceover: blob, voiceoverDuration: audio.audio.length / audio.sampling_rate })
      downloadBlob(`${project.name.replace(/[^\w-]+/g, '-')}-voiceover.wav`, blob)
      setBusy('')
    } catch (caught) {
      setBusy('')
      setError(`Kokoro voice generation failed: ${caught instanceof Error ? caught.message : 'unknown error'}. You can preview with your browser voice below.`)
    }
  }

  const previewVoice = () => {
    if (!('speechSynthesis' in window)) { setError('Web Speech voices are unavailable in this browser.'); return }
    if (voicePreview) { window.speechSynthesis.cancel(); setVoicePreview(false); return }
    const utterance = new SpeechSynthesisUtterance(project.script || 'This is a VAR Studio voice preview. Review the incident and the available angles before making a decision.')
    const voices = window.speechSynthesis.getVoices()
    const chosen = voices.find(voice => voice.name.toLowerCase().includes(settings.language.toLowerCase()))
    if (chosen) utterance.voice = chosen
    utterance.rate = settings.speed
    utterance.pitch = settings.pitch
    utterance.onend = () => setVoicePreview(false)
    utterance.onerror = () => { setVoicePreview(false); setError('Browser speech synthesis could not play this preview.') }
    setVoicePreview(true)
    window.speechSynthesis.speak(utterance)
  }

  const transcribe = async () => {
    if (!selectedAsset) { setError('Import a video file before transcribing.'); return }
    setBusy('Downloading Whisper model for local transcription')
    setError('')
    try {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowLocalModels = false
      const transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
        device: 'webgpu' in navigator ? 'webgpu' : 'wasm',
        dtype: 'q8',
      })
      setTranscriptionReady(true)
      setBusy('Transcribing audio in this browser')
      const audioBuffer = await decodeMonoAudio(selectedAsset.blob)
      const result = await transcriber(audioBuffer, { chunk_length_s: 20, stride_length_s: 4, return_timestamps: false })
      const transcript = typeof result === 'object' && result && 'text' in result ? String(result.text) : ''
      if (!transcript) throw new Error('Whisper returned no transcript.')
      snapshot()
      update({ transcript })
    } catch (caught) {
      setError(`Browser Whisper transcription failed: ${caught instanceof Error ? caught.message : 'unknown error'}. Check available memory/network and try again.`)
    } finally { setBusy('') }
  }

  const startExport = async () => {
    if (!selectedAsset) { setError('Import a video file before exporting.'); return }
    if (!rightsConfirmed) { setError('Confirm that you own or have rights to the footage before exporting.'); return }
    if (shortTooLong) { setError('Shorts are limited to 60 seconds. Trim the source footage or export in 16:9.'); return }
    setBusy('Preparing browser video renderer')
    renderCancelled.current = false
    setProgress(0)
    setError('')
    try {
      const blob = await renderVideo(project, selectedAsset.id, setProgress, cancel => setRenderCancel(() => cancel))
      downloadBlob(`${project.name.replace(/[^\w-]+/g, '-')}-${project.aspect.replace(':', 'x')}.mp4`, blob)
      setRenderedVideo(blob)
      setRenderedVideoAssetId(selectedAsset.id)
      setRenderedVideoAspect(project.aspect)
      setYoutubeTitle(project.name)
    } catch (caught) {
      if (!renderCancelled.current) setError(`Video export failed: ${caught instanceof Error ? caught.message : 'unknown error'}. For large footage, try Draft quality or use a device with more memory.`)
    } finally { setBusy(''); setProgress(0); setRenderCancel(null) }
  }

  const connectYouTube = async () => {
    let authorization: Promise<string>
    try {
      authorization = authorizeYouTube(settings.youtubeClientId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start YouTube authorization.')
      return
    }
    setBusy('Waiting for Google channel authorization')
    setError('')
    try {
      const token = await authorization
      const channel = await getConnectedYouTubeChannel(token)
      if (youtubeToken) revokeYouTubeToken(youtubeToken)
      setYoutubeToken(token)
      setYoutubeChannel(channel.title)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect your YouTube channel.')
    } finally { setBusy('') }
  }

  const disconnectYouTube = () => {
    if (youtubeToken) revokeYouTubeToken(youtubeToken)
    setYoutubeToken('')
    setYoutubeChannel('')
    setUploadProgress(0)
  }

  const publishToYouTube = async () => {
    if (!renderedVideo || !renderedVideoIsCurrent) { setError('Render the currently selected footage and aspect ratio in this session before uploading it to YouTube.'); return }
    if (!rightsConfirmed) { setError('Confirm that you own or have rights to the footage before uploading.'); return }
    if (!youtubeToken) { setError('Connect your YouTube channel in Settings before uploading.'); return }
    if (!youtubeTitle.trim()) { setError('Enter a title for the YouTube video.'); return }
    const controller = new AbortController()
    uploadController.current = controller
    setBusy('Uploading rendered MP4 to YouTube')
    setUploadProgress(0)
    setError('')
    try {
      const url = await uploadToYouTube(youtubeToken, renderedVideo, {
        title: youtubeTitle,
        description: youtubeDescription,
        privacyStatus: youtubePrivacy,
      }, setUploadProgress, controller.signal)
      setError('')
      window.open(url, '_blank', 'noopener,noreferrer')
      setBusy('')
      setUploadProgress(1)
      setYoutubeToken('')
      setYoutubeChannel('')
      revokeYouTubeToken(youtubeToken)
      setActiveModal(null)
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : 'YouTube upload failed. Your rendered file is still available to download.')
      }
    } finally {
      if (uploadController.current === controller) uploadController.current = null
      setBusy('')
    }
  }

  const exportProjectZip = async () => {
    setBusy('Packaging project and media')
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const media: Array<{ id: string; path: string }> = []
      for (const asset of project.assets) {
        const path = `media/${asset.id}-${asset.name.replace(/[^\w.-]/g, '_')}`
        zip.file(path, asset.blob)
        media.push({ id: asset.id, path })
      }
      if (project.voiceover) zip.file('media/voiceover.wav', project.voiceover)
      const metadata = { ...project, assets: project.assets.map(({ blob: _blob, ...asset }) => asset), voiceover: undefined, media, hasVoiceover: Boolean(project.voiceover) }
      zip.file('project.json', JSON.stringify(metadata, null, 2))
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      downloadBlob(`${project.name.replace(/[^\w-]+/g, '-')}.varstudio.zip`, blob)
    } catch (caught) { setError(caught instanceof Error ? `Project archive failed: ${caught.message}` : 'Could not create project archive.') }
    finally { setBusy('') }
  }

  const importProjectZip = async (file: File) => {
    setBusy('Restoring project archive')
    setError('')
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(file)
      const projectFile = zip.file('project.json')
      if (!projectFile) throw new Error('This archive does not contain project.json.')
      const metadata = JSON.parse(await projectFile.async('string')) as Project & { media: Array<{ id: string; path: string }>; hasVoiceover: boolean }
      if (!metadata.id || !Array.isArray(metadata.media) || !Array.isArray(metadata.incidents)) throw new Error('The project archive has an invalid structure.')
      const assets = await Promise.all(metadata.media.map(async entry => {
        const entryFile = zip.file(entry.path)
        if (!entryFile) throw new Error(`Missing media file: ${entry.path}`)
        const prior = metadata.assets.find(asset => asset.id === entry.id)
        if (!prior) throw new Error(`Missing media metadata for ${entry.path}`)
        return { ...prior, blob: await entryFile.async('blob') }
      }))
      const voiceover = metadata.hasVoiceover ? await zip.file('media/voiceover.wav')?.async('blob') : undefined
      if (metadata.hasVoiceover && !voiceover) throw new Error('The archive is missing its voiceover media.')
      const restored = { ...metadata, assets, voiceover }
      setProject(restored)
      await saveProject(restored)
      await refreshProjects()
    } catch (caught) { setError(`Project import failed: ${caught instanceof Error ? caught.message : 'invalid archive'}`) }
    finally { setBusy(''); if (importRef.current) importRef.current.value = '' }
  }

  const downloadThumbnail = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) { setError('Import a video and seek to the frame you want as a thumbnail.'); return }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) { setError('This browser could not create a thumbnail canvas.'); return }
    context.drawImage(video, 0, 0)
    canvas.toBlob(blob => { if (blob) downloadBlob(`${project.name.replace(/[^\w-]+/g, '-')}-thumbnail.jpg`, blob); else setError('Could not encode the thumbnail.') }, 'image/jpeg', 0.92)
  }

  const downloadScript = () => downloadText(`${project.name.replace(/[^\w-]+/g, '-')}-script.txt`, project.script, 'text/plain;charset=utf-8')

  const runShortcut = useCallback((event: KeyboardEvent) => {
    if (activeModal || (event.target as HTMLElement).matches('input,textarea,select,[contenteditable="true"]')) return
    if (event.code === 'Space') { event.preventDefault(); setPlaying(value => !value) }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && event.shiftKey) { event.preventDefault(); redo() }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo() }
    else if (event.code === 'ArrowLeft') seek(project.playhead - (event.shiftKey ? 5 : 1))
    else if (event.code === 'ArrowRight') seek(project.playhead + (event.shiftKey ? 5 : 1))
    else if (event.key.toLowerCase() === 'm') addIncident('Offside')
    else if (event.key.toLowerCase() === 's') splitAtPlayhead()
  }, [activeModal, addIncident, project.playhead, redo, seek, undo])

  useEffect(() => {
    window.addEventListener('keydown', runShortcut)
    return () => window.removeEventListener('keydown', runShortcut)
  }, [runShortcut])

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || !video.videoWidth) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width, height } = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, width * dpr)
    canvas.height = Math.max(1, height * dpr)
    ctx.scale(dpr, dpr)
    const frame = () => {
      ctx.clearRect(0, 0, width, height)
      if (quality === 'Full') {
        const active = project.overlays.filter(item => item.time <= project.playhead && item.time >= project.playhead - 12)
        active.forEach(item => {
          const x = width * item.x / 100
          const y = height * item.y / 100
          ctx.strokeStyle = item.color
          ctx.fillStyle = item.color
          ctx.lineWidth = 3
          if (item.type.includes('line')) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(width * Math.min(0.99, item.x / 100 + 0.42), y + height * 0.12); ctx.stroke()
          } else if (item.type === 'Circle' || item.type === 'Spotlight' || item.type === 'Zoom') {
            ctx.beginPath(); ctx.ellipse(x, y, item.type === 'Spotlight' ? 58 : 42, item.type === 'Spotlight' ? 76 : 34, 0, 0, Math.PI * 2); ctx.stroke()
          } else if (item.type === 'Arrow') {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 90, y - 42); ctx.lineTo(x + 68, y - 37); ctx.moveTo(x + 90, y - 42); ctx.lineTo(x + 78, y - 20); ctx.stroke()
          } else if (item.text) {
            ctx.font = '600 14px Inter, sans-serif'
            const content = item.type === 'Verdict' ? `✓  ${item.text}` : item.text
            const tw = ctx.measureText(content).width
            ctx.fillStyle = item.type === 'Verdict' ? '#9fea63' : 'rgba(10,15,13,.78)'
            ctx.fillRect(x, y, Math.min(width - x, tw + 24), 34)
            ctx.fillStyle = item.type === 'Verdict' ? '#101312' : '#ffffff'
            ctx.fillText(content, x + 12, y + 22)
          }
          if (selectedOverlayId === item.id) {
            ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ffffff'; ctx.strokeRect(x - 8, y - 8, 96, 44); ctx.setLineDash([])
          }
        })
      }
      if (playing) requestAnimationFrame(frame)
    }
    frame()
  }, [project.overlays, project.playhead, selectedOverlayId, playing, quality, selectedAssetId])

  useEffect(() => {
    const canvas = timelineRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, rect.width * dpr)
    canvas.height = Math.max(1, rect.height * dpr)
    ctx.scale(dpr, dpr)
    const width = rect.width
    const height = rect.height
    const duration = Math.max(project.duration, 30)
    ctx.fillStyle = '#121715'
    ctx.fillRect(0, 0, width, height)
    ctx.font = '10px Inter, sans-serif'
    ctx.fillStyle = '#768079'
    const steps = Math.max(1, Math.ceil(duration / 10))
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * width
      ctx.strokeStyle = '#2a312d'; ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, height); ctx.stroke()
      ctx.fillText(formatTime(duration * i / steps), x + 4, 13)
    }
    const xAt = (time: number) => Math.min(width, Math.max(0, time / duration * width))
    project.assets.forEach((asset, index) => {
      const start = project.assets.slice(0, index).reduce((sum, item) => sum + item.duration, 0)
      const x = xAt(start)
      const w = Math.max(5, xAt(start + asset.duration) - x)
      ctx.fillStyle = '#244631'; ctx.beginPath(); ctx.roundRect(x, 26, w - 2, 34, 5); ctx.fill()
      ctx.fillStyle = '#b9e8a0'; ctx.fillText(asset.name.slice(0, Math.max(5, Math.floor(w / 7))), x + 7, 46)
    })
    project.overlays.forEach((item, index) => {
      const x = xAt(item.time)
      ctx.fillStyle = index % 2 ? '#5368ab' : '#41548c'
      ctx.beginPath(); ctx.roundRect(x, 66, 58, 13, 3); ctx.fill()
    })
    project.captions.forEach(caption => {
      const x = xAt(caption.start); const w = Math.max(7, xAt(caption.end) - x)
      ctx.fillStyle = '#9474ab'; ctx.fillRect(x, 85, w, 8)
    })
    if (project.voiceover && project.voiceoverDuration) {
      const w = Math.max(7, xAt(project.voiceoverDuration))
      ctx.fillStyle = '#634b79'; ctx.beginPath(); ctx.roundRect(0, 104, w, 12, 3); ctx.fill()
      ctx.fillStyle = '#c7a9d9'; ctx.font = '8px Inter, sans-serif'; ctx.fillText('KOKORO VOICEOVER', 5, 113)
    }
    project.incidents.forEach(item => {
      const x = xAt(item.time)
      ctx.fillStyle = toolColors[item.type]
      ctx.beginPath(); ctx.moveTo(x, 121); ctx.lineTo(x - 5, 131); ctx.lineTo(x + 5, 131); ctx.fill()
    })
    const playX = xAt(project.playhead)
    ctx.strokeStyle = '#9fea63'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(playX, 18); ctx.lineTo(playX, height); ctx.stroke()
  }, [project.assets, project.duration, project.incidents, project.overlays, project.captions, project.playhead])

  const timelineClick = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!project.duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    seek(((event.clientX - rect.left) / rect.width) * Math.max(project.duration, 30))
  }

  const projectLoad = async (id: string) => {
    const chosen = projectList.find(item => item.id === id)
    if (chosen) { setProject(chosen); setProjectMenu(false) }
  }

  const showTranscriptCaptions = () => {
    const text = project.transcript || project.script
    if (!text.trim()) { setError('Run Whisper transcription or add a script before creating captions.'); return }
    snapshot()
    update({ captions: scriptToCaptions(text, project.duration) })
  }

  const addTrackItem = (track: TrackName) => {
    if (track === 'Footage') inputRef.current?.click()
    if (track === 'Voiceover') void generateVoice()
    if (track === 'Graphics') setActiveTool('Text')
    if (track === 'Music') setError('Music track: import a music bed as a video file with audio, then mute its picture using a video editor export. Standalone audio tracks are not mixed by this browser build.')
  }

  return (
    <main className="app-shell" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span>V</span><span className="brand-check">✓</span></div>
          <div><strong>VAR Studio</strong><small>FOOTBALL VIDEO LAB</small></div>
        </div>
        <div className="project-header">
          <div className="project-title">
            <input aria-label="Project name" value={project.name} onChange={event => update({ name: event.target.value })} />
            <span className="saved-indicator"><i className={isDirty ? 'is-dirty' : ''} />{isDirty ? 'Unsaved changes' : 'Saved locally'}</span>
          </div>
          <button className="plain-button project-switch" onClick={() => setProjectMenu(value => !value)}><ChevronDown size={14} /></button>
          {projectMenu && <div className="project-menu">
            <button onClick={() => void createProject()}><Plus size={15} /> New analysis</button>
            {projectList.map(item => <button key={item.id} onClick={() => void projectLoad(item.id)}><Film size={15} /> {item.name}</button>)}
            <button onClick={() => importRef.current?.click()}><FileArchive size={15} /> Import project archive</button>
          </div>}
        </div>
        <div className="top-actions">
          <span className="private-badge"><LockKeyhole size={13} /> PRIVATE & LOCAL</span>
          <button className="icon-button" title="Keyboard shortcuts and guide" onClick={() => setActiveModal('help')}><HelpCircle size={17} /></button>
          <button className="icon-button" title="Settings" onClick={() => setActiveModal('settings')}><Settings size={17} /></button>
          <button className="button button-save" onClick={() => void saveProjectNow()}><Check size={15} /> Save</button>
          <button className="button button-primary" onClick={() => { setRightsConfirmed(false); setActiveModal('export') }}><Download size={15} /> Export</button>
        </div>
      </header>

      {error && <div className="error-banner"><span>{error}</span><button className="plain-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
      {busy && <div className="busy-banner"><LoaderCircle size={15} className="spin" /> {busy}{(progress > 0 || uploadController.current) && <span>{Math.round((uploadController.current ? uploadProgress : progress) * 100)}%</span>}{renderCancel && <button className="plain-button" onClick={() => { renderCancelled.current = true; renderCancel(); setRenderCancel(null); setBusy(''); setProgress(0) }} aria-label="Cancel export"><X size={15} /></button>}{uploadController.current && <button className="plain-button" onClick={() => uploadController.current?.abort()} aria-label="Cancel YouTube upload"><X size={15} /></button>}</div>}
      {shortTooLong && <div className="warning-banner"><Clock3 size={15} /> This project is longer than the 60-second Shorts limit. Trim footage or switch to 16:9.</div>}

      <section className="workspace">
        <aside className="left-panel panel">
          <div className="panel-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>Media & tools</h2></div><button className="small-icon" title="Add footage" onClick={() => inputRef.current?.click()}><Plus size={17} /></button></div>
          <div className="aspect-switch">
            <button className={project.aspect === '16:9' ? 'active' : ''} onClick={() => update({ aspect: '16:9' })}><span className="aspect-icon wide" />Long-form</button>
            <button className={project.aspect === '9:16' ? 'active' : ''} onClick={() => update({ aspect: '9:16' })}><span className="aspect-icon vertical" />Shorts</button>
          </div>
          <button className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => inputRef.current?.click()} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)}>
            <span className="upload-icon"><Upload size={18} /></span><strong>Drop match footage here</strong><small>MP4, MOV or WebM · stays on this device</small>
          </button>
          <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" multiple hidden onChange={event => { if (event.target.files) void handleFiles(event.target.files); event.target.value = '' }} />
          <input ref={importRef} type="file" accept=".varstudio.zip,.zip" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importProjectZip(file) }} />
          <div className="section-row"><span className="eyebrow">MEDIA BIN</span><span className="count-pill">{project.assets.length}</span></div>
          <div className="media-list">
            {project.assets.map(asset => <button key={asset.id} className={`media-item ${selectedAsset?.id === asset.id ? 'selected' : ''}`} onClick={() => useEditor.getState().selectAsset(asset.id)}>
              {asset.thumbnail ? <img src={asset.thumbnail} alt="" /> : <span className="media-thumb"><Film size={17} /></span>}
              <span className="media-copy"><strong title={asset.name}>{asset.name}</strong><small>{formatTime(asset.duration)} · {formatBytes(asset.size)}</small></span>
              <button className="remove-media" title="Remove from project" onClick={event => { event.stopPropagation(); snapshot(); update({ assets: project.assets.filter(item => item.id !== asset.id) }); useEditor.getState().selectAsset(project.assets.find(item => item.id !== asset.id)?.id ?? null) }}><X size={13} /></button>
            </button>)}
            {!project.assets.length && <div className="empty-media"><FolderOpen size={17} /><span>Your footage will appear here</span></div>}
          </div>
          <div className="panel-separator" />
          <div className="section-row"><span className="eyebrow">ANALYSIS TOOLS</span></div>
          <div className="tool-grid">
            {overlayTypes.map((type, index) => {
              const Icon = toolIcons[index]
              return <button key={type} title={`${type} — click, then click the preview`} className={activeTool === type ? 'tool active' : 'tool'} onClick={() => setActiveTool(activeTool === type ? null : type)}><Icon size={16} /><span>{type}</span></button>
            })}
          </div>
          <div className="section-row markers-heading"><span className="eyebrow">INCIDENT MARKERS</span><span className="count-pill">{project.incidents.length}</span></div>
          <select className="select-control add-marker-select" value="" onChange={addMarkerAtPlayhead}>
            <option value="" disabled>＋ Add marker at playhead</option>
            {incidentTypes.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
          <div className="marker-list">
            {project.incidents.map(item => <button key={item.id} className={`marker-item ${selectedIncidentId === item.id ? 'selected' : ''}`} onClick={() => { useEditor.setState({ selectedIncidentId: item.id, selectedOverlayId: null }); seek(item.time) }}>
              <span className="marker-dot" style={{ backgroundColor: toolColors[item.type] }} /><strong>{item.type}</strong><time>{formatTime(item.time)}</time>
            </button>)}
            {!project.incidents.length && <p className="quiet-note">Add a marker while reviewing a key moment.</p>}
          </div>
        </aside>

        <section className="center-panel">
          <div className="preview-toolbar">
            <div className="toolbar-left"><span className="live-pill"><span /> LIVE PREVIEW</span><span className="preview-resolution">{project.aspect} · {quality === 'Draft' ? 'Draft quality' : 'Full overlays'}</span></div>
            <div className="toolbar-right">
              <button className={`tool-toggle ${quality === 'Draft' ? 'selected' : ''}`} onClick={() => setQuality(quality === 'Draft' ? 'Full' : 'Draft')} title="Draft mode reduces live overlay rendering for low-end devices"><Gauge size={14} />{quality}</button>
              <button className="icon-button subtle" title="Zoom out" onClick={() => setZoom(value => Math.max(.65, value - .1))}><ZoomOut size={15} /></button><span className="zoom-value">{Math.round(zoom * 100)}%</span><button className="icon-button subtle" title="Zoom in" onClick={() => setZoom(value => Math.min(1.5, value + .1))}><ZoomIn size={15} /></button>
            </div>
          </div>
          <div className={`preview-area ${project.aspect === '9:16' ? 'portrait' : ''}`} onPointerDown={onStagePointerDown}>
            <div className="video-stage" style={{ transform: `scale(${zoom})` }}>
              {videoUrl ? <video ref={videoRef} src={videoUrl} playsInline preload="metadata" onLoadedMetadata={event => {
                const video = event.currentTarget
                if (video.duration && Number.isFinite(video.duration)) update({ duration: video.duration })
                if (video.duration > 3600 || selectedAsset && selectedAsset.size > 1_500_000_000) setError('Large-footage memory warning: use Draft preview, save often, and export short sections on this device.')
              }} onTimeUpdate={event => update({ playhead: event.currentTarget.currentTime })} onEnded={() => setPlaying(false)} />
              : <div className="preview-empty"><div className="pitch-graphic"><span className="pitch-circle" /><span className="pitch-line" /><span className="pitch-box top" /><span className="pitch-box bottom" /></div><div className="empty-copy"><span className="eyebrow">READY WHEN YOU ARE</span><h3>Bring the moment<br />into focus.</h3><p>Import match footage, mark the incident, then build your analysis.</p><button className="button button-primary" onClick={() => inputRef.current?.click()}><Upload size={15} /> Import footage</button></div><span className="preview-footnote">LOCAL-FIRST · YOUR MEDIA NEVER LEAVES THIS DEVICE</span></div>}
              <canvas ref={canvasRef} className={`overlay-canvas ${quality === 'Draft' ? 'hidden' : 'interactive'}`} onPointerDown={onOverlayPointerDown} onPointerMove={onOverlayPointerMove} onPointerUp={() => setDraggingOverlayId(null)} onPointerCancel={() => setDraggingOverlayId(null)} />
              {activeTool && <div className="tool-hint"><MousePointer2 size={13} /> Click the frame to place {activeTool}<button onClick={() => setActiveTool(null)}><X size={13} /></button></div>}
            </div>
          </div>
          <div className="transport">
            <div className="transport-side"><button className="plain-button" title="Previous incident" onClick={() => { const prev = [...project.incidents].reverse().find(item => item.time < project.playhead); if (prev) seek(prev.time) }}><ArrowLeft size={15} /></button><button className="plain-button" title="Step back 1 second" onClick={() => seek(project.playhead - 1)}><Minus size={14} /></button><span className="timecode">{formatTime(project.playhead)} <i>/</i> {formatTime(project.duration)}</span><button className="plain-button" title="Step forward 1 second" onClick={() => seek(project.playhead + 1)}><Plus size={14} /></button><button className="plain-button" title="Next incident" onClick={() => { const next = project.incidents.find(item => item.time > project.playhead); if (next) seek(next.time) }}><ArrowRight size={15} /></button></div>
            <button className="play-button" onClick={() => setPlaying(value => !value)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
            <div className="transport-side right"><button className="plain-button" title="Add offside marker (M)" onClick={() => addIncident('Offside')}><Flag size={15} /></button><button className="plain-button" title="Split at playhead (S)" onClick={splitAtPlayhead}><Scissors size={15} /></button><button className="plain-button" title="Remove selected marker/overlay" onClick={removeSelected}><Trash2 size={15} /></button></div>
          </div>
          <section className="timeline-panel panel">
            <div className="timeline-heading"><div><Layers size={15} /><strong>Timeline</strong><span className="eyebrow">MULTI-LAYER</span></div><div className="timeline-controls"><button title="Undo (Ctrl+Z)" onClick={undo}><Undo2 size={15} /></button><button title="Redo (Ctrl+Shift+Z)" onClick={redo}><Redo2 size={15} /></button><button title="Split (S)" onClick={splitAtPlayhead}><Scissors size={14} /></button><button title="Add footage track" onClick={() => addTrackItem('Footage')}><Plus size={15} /></button><button title="Zoom timeline" onClick={() => setZoom(value => value === 1 ? 1.15 : 1)}><ZoomIn size={15} /></button></div></div>
            <div className="timeline-inner">
              <div className="track-labels"><span>VIDEO</span><span>GRAPHICS</span><span>CAPTIONS</span><span>VOICE</span><span>MARKERS</span></div>
              <canvas ref={timelineRef} className="timeline-canvas" onPointerDown={timelineClick} aria-label="Timeline; click to seek" />
            </div>
            <div className="timeline-footer"><span><span className="track-key video-key" /> Footage</span><span><span className="track-key graphics-key" /> Graphics</span><span><span className="track-key captions-key" /> Captions</span><span><span className="track-key marker-key" /> Incidents</span><span className="timeline-shortcuts"><Keyboard size={12} /> Space play · M marker · S split</span></div>
          </section>
        </section>

        <aside className="right-panel panel">
          <div className="inspector-tabs"><button className="active"><PenLine size={14} />Inspector</button><button onClick={() => setActiveModal('settings')}><Sparkles size={14} />AI tools</button></div>
          {selectedIncident ? <div className="inspector-content">
            <div className="inspector-title"><div><span className="eyebrow">INCIDENT MARKER</span><h2>{selectedIncident.type}</h2></div><button className="small-icon" title="Delete marker" onClick={removeSelected}><Trash2 size={15} /></button></div>
            <label className="field-label">Incident type</label><select className="select-control" value={selectedIncident.type} onChange={event => updateIncident(selectedIncident.id, { type: event.target.value as IncidentType })}>{incidentTypes.map(type => <option key={type}>{type}</option>)}</select>
            <label className="field-label">Timestamp</label><input className="text-control" type="number" min="0" step="0.1" value={selectedIncident.time} onChange={event => { const time = Number(event.target.value); updateIncident(selectedIncident.id, { time }); seek(time) }} />
            <label className="field-label">Analyst notes</label><textarea className="text-control notes-input" placeholder="What should viewers notice? Keep observations factual." value={selectedIncident.note} onChange={event => updateIncident(selectedIncident.id, { note: event.target.value })} />
            <div className="field-hint"><ShieldCheck size={14} /> Notes are saved only in this browser.</div>
          </div> : selectedOverlay ? <div className="inspector-content">
            <div className="inspector-title"><div><span className="eyebrow">ON-FRAME GRAPHIC</span><h2>{selectedOverlay.type}</h2></div><button className="small-icon" title="Delete graphic" onClick={removeSelected}><Trash2 size={15} /></button></div>
            <label className="field-label">Label text</label><input className="text-control" value={selectedOverlay.text} onChange={event => updateSelectedOverlay({ text: event.target.value })} />
            <label className="field-label">Graphic color</label><input className="color-control" type="color" value={selectedOverlay.color} onChange={event => updateSelectedOverlay({ color: event.target.value })} />
            <label className="field-label">Frame position</label><div className="position-controls"><label>X <input type="number" min="0" max="100" value={Math.round(selectedOverlay.x)} onChange={event => updateSelectedOverlay({ x: Number(event.target.value) })} /></label><label>Y <input type="number" min="0" max="100" value={Math.round(selectedOverlay.y)} onChange={event => updateSelectedOverlay({ y: Number(event.target.value) })} /></label></div>
            <p className="field-hint"><Move size={14} /> Click and drag the graphic to reposition it.</p>
          </div> : <div className="inspector-content">
            <div className="inspector-title"><div><span className="eyebrow">PROJECT INSPECTOR</span><h2>Analysis desk</h2></div><MoreHorizontal size={18} /></div>
            <div className="stat-grid"><div><span>FORMAT</span><strong>{project.aspect}</strong></div><div><span>DURATION</span><strong>{formatTime(project.duration)}</strong></div><div><span>INCIDENTS</span><strong>{project.incidents.length}</strong></div><div><span>MEDIA</span><strong>{project.assets.length} files</strong></div></div>
            <label className="field-label">YouTube reference <span className="label-note">scouting only</span></label><div className="input-with-icon"><Link2 size={14} /><input type="url" value={project.youtubeUrl} onChange={event => update({ youtubeUrl: event.target.value })} placeholder="https://youtube.com/watch?v=…" /></div>
            {project.youtubeUrl && youtubeEmbed(project.youtubeUrl) && <div className="embed-wrap"><iframe title="YouTube reference video — preview only" src={youtubeEmbed(project.youtubeUrl)} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>}
            {project.youtubeUrl && <p className="field-hint"><ShieldCheck size={14} />{youtubeEmbed(project.youtubeUrl) ? 'Reference embed only. VAR Studio never imports or renders this YouTube video.' : 'Enter a valid YouTube video link to show its reference preview.'}</p>}
            <label className="field-label">Reference notes</label><textarea className="text-control reference-notes" placeholder="Scouting timestamps, source title, camera notes…" value={project.youtubeNotes} onChange={event => update({ youtubeNotes: event.target.value })} />
            <div className="panel-separator" />
            <div className="section-title-line"><span className="eyebrow">AI ANALYSIS</span><span className="ai-status"><span /> {settings.apiKey ? settings.provider : 'ADD KEY'}</span></div>
            <button className="ai-action" onClick={transcribe} disabled={!selectedAsset || Boolean(busy)}><span className="action-icon"><AudioLines size={16} /></span><span><strong>{transcriptionReady ? 'Transcribe again' : 'Transcribe footage'}</strong><small>Whisper runs locally in your browser</small></span><ArrowRight size={14} /></button>
            <button className="ai-action" onClick={() => void generateScript()} disabled={Boolean(busy)}><span className="action-icon"><WandSparkles size={16} /></span><span><strong>Write commentary</strong><small>Based on markers & transcript</small></span><ArrowRight size={14} /></button>
            <button className="ai-action" onClick={() => void aiAction('titles')} disabled={Boolean(busy)}><span className="action-icon"><Clapperboard size={16} /></span><span><strong>Title & thumbnail ideas</strong><small>Responsible, factual suggestions</small></span><ArrowRight size={14} /></button>
            <button className="ai-action" onClick={() => void aiAction('description')} disabled={Boolean(busy)}><span className="action-icon"><PenLine size={16} /></span><span><strong>Description & chapters</strong><small>Use incident timestamps</small></span><ArrowRight size={14} /></button>
            <button className="ai-action" onClick={() => void aiAction('hashtags')} disabled={Boolean(busy)}><span className="action-icon"><Sparkles size={16} /></span><span><strong>Hashtag ideas</strong><small>Generate a relevant tag list</small></span><ArrowRight size={14} /></button>
            <button className="ai-action" onClick={() => void aiAction('thumbnail')} disabled={Boolean(busy)}><span className="action-icon"><Image size={16} /></span><span><strong>Thumbnail frame ideas</strong><small>Choose a still on the timeline</small></span><ArrowRight size={14} /></button>
            <button className="ai-action" onClick={() => void aiAction('translation')} disabled={Boolean(busy) || !project.captions.length}><span className="action-icon"><Languages size={16} /></span><span><strong>Translate captions</strong><small>Uses language from Settings</small></span><ArrowRight size={14} /></button>
          </div>}
          <div className="voice-card">
            <div className="voice-title"><span className="action-icon"><Mic2 size={16} /></span><div><strong>Voiceover studio</strong><small>{project.voiceover ? 'Kokoro voice ready' : 'Local Kokoro neural voice'}</small></div><AudioLines size={15} className="voice-wave" /></div>
            <div className="voice-buttons"><button onClick={previewVoice}><Volume2 size={14} />{voicePreview ? 'Stop preview' : 'Browser preview'}</button><button className="voice-generate" onClick={() => void generateVoice()} disabled={Boolean(busy)}><Mic2 size={14} />Generate voice</button></div>
            {project.voiceover && <audio className="voice-audio" controls src={voiceoverUrl} />}
            <p>Generates locally in your browser; first model download needs internet. Browser preview uses system voices.</p>
          </div>
        </aside>
      </section>

      <section className="bottom-panel panel">
        <div className="bottom-tabs"><button className="active"><Captions size={14} />Script & captions</button><button onClick={() => void generateScript()}><Sparkles size={13} />AI script</button><button onClick={() => void saveProjectNow()}><Cloud size={14} />Local project</button></div>
        <div className="script-section">
          <div className="script-column"><div className="subsection-heading"><div><span className="eyebrow">VOICEOVER SCRIPT</span><span className="script-badge">EDITABLE</span></div><div className="script-actions"><button onClick={downloadScript}><ArrowDownToLine size={13} /> .TXT</button><button onClick={showTranscriptCaptions}><Captions size={13} /> Make captions</button><button onClick={previewVoice}><Play size={12} /> Preview</button></div></div>
            <textarea className="script-editor" placeholder="Write commentary here, or generate it from your incident notes and transcript…" value={project.script} onChange={event => update({ script: event.target.value })} />
            <div className="transcript-row"><label><span className="eyebrow">SOURCE TRANSCRIPT</span><textarea className="transcript-editor" placeholder="Whisper transcript appears here. You can edit it before writing commentary." value={project.transcript} onChange={event => update({ transcript: event.target.value })} /></label><button className="button button-outline" disabled={!selectedAsset || Boolean(busy)} onClick={transcribe}><AudioLines size={14} /> Whisper</button></div>
          </div>
          <div className="caption-column"><div className="subsection-heading"><div><span className="eyebrow">CAPTION SEGMENTS</span><span className="count-pill">{project.captions.length}</span></div><div className="script-actions"><button onClick={() => downloadText(`${project.name.replace(/[^\w-]+/g, '-')}.srt`, captionsToSrt(project.captions), 'text/srt;charset=utf-8')}><ArrowDownToLine size={13} /> .SRT</button><button onClick={() => { snapshot(); update({ captions: [...project.captions, { id: newId(), start: project.playhead, end: project.playhead + 3, text: 'New caption' }] }) }}><Plus size={13} /> Add</button></div></div>
            <div className="caption-list">{project.captions.map(caption => <div className="caption-row" key={caption.id}><span>{formatTime(caption.start)}</span><input value={caption.text} onChange={event => update({ captions: project.captions.map(item => item.id === caption.id ? { ...item, text: event.target.value } : item) })} /><button title="Delete caption" onClick={() => { snapshot(); update({ captions: project.captions.filter(item => item.id !== caption.id) }) }}><X size={13} /></button></div>)}
              {!project.captions.length && <div className="captions-empty"><Captions size={17} /><span>Create editable caption segments from the transcript or script.</span></div>}
            </div>
          </div>
        </div>
      </section>

      {showWelcome && <div className="welcome-overlay"><div className="welcome-card"><button className="welcome-close" onClick={() => { setShowWelcome(false); localStorage.setItem('var-studio-welcomed', '1') }}><X size={16} /></button><div className="welcome-mark"><span>V</span><span>✓</span></div><span className="eyebrow">YOUR PRIVATE ANALYSIS DESK</span><h1>Every decision.<br /><em>Frame by frame.</em></h1><p>Import your own match footage, annotate incidents, build commentary and export a video. Your files stay in your browser.</p><div className="welcome-features"><span><LockKeyhole size={14} /> Local-first & private</span><span><Sparkles size={14} /> AI with your own key</span><span><Film size={14} /> Browser video export</span></div><div className="welcome-actions"><button className="button button-primary" onClick={() => { setShowWelcome(false); localStorage.setItem('var-studio-welcomed', '1'); inputRef.current?.click() }}><Plus size={15} /> Start with footage</button><button className="button button-outline" onClick={() => void createSample()}>Open sample analysis</button></div><small>By using this studio, confirm that you have the rights to any footage you upload.</small></div></div>}

      {aiOutput && <div className="modal-scrim" onClick={() => setAiOutput(null)}><section className="modal-card output-modal" onClick={event => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">AI ASSISTANT</span><h2>{aiOutput.title}</h2></div><button className="icon-button" onClick={() => setAiOutput(null)}><X size={17} /></button></div><textarea className="text-control ai-output" value={aiOutput.text} onChange={event => setAiOutput({ ...aiOutput, text: event.target.value })} /><div className="modal-actions"><button className="button button-outline" onClick={() => { void navigator.clipboard.writeText(aiOutput.text); setError('Copied to clipboard.') }}>Copy text</button><button className="button button-primary" onClick={() => { update({ youtubeNotes: `${project.youtubeNotes}${project.youtubeNotes ? '\n\n' : ''}${aiOutput.title.toUpperCase()}\n${aiOutput.text}` }); setAiOutput(null) }}>Save to project notes</button></div></section></div>}

      {activeModal && <div className="modal-scrim" onClick={() => setActiveModal(null)}><section className="modal-card" onClick={event => event.stopPropagation()}>
        <div className="modal-heading"><div><span className="eyebrow">{activeModal === 'settings' ? 'PREFERENCES' : activeModal === 'export' ? 'RENDER & DOWNLOAD' : 'QUICK GUIDE'}</span><h2>{activeModal === 'settings' ? 'Studio settings' : activeModal === 'export' ? 'Export your analysis' : 'Keyboard shortcuts'}</h2></div><button className="icon-button" onClick={() => setActiveModal(null)}><X size={17} /></button></div>
        {activeModal === 'settings' && <div className="modal-content">
          <div className="privacy-callout"><LockKeyhole size={17} /><span><strong>Your key stays here.</strong><small>Stored in this browser only. AI requests go directly to your chosen free-tier provider.</small></span></div>
          <label className="field-label">AI provider</label><select className="select-control" value={settings.provider} onChange={event => setSettings({ ...settings, provider: event.target.value as 'Gemini' | 'Groq' })}><option>Gemini</option><option>Groq</option></select>
          <label className="field-label">Your {settings.provider} API key</label><input className="text-control" type="password" autoComplete="off" value={settings.apiKey} onChange={event => setSettings({ ...settings, apiKey: event.target.value })} placeholder="Paste a key from the provider’s free tier" />
          <div className="settings-grid"><label><span className="field-label">Commentary style</span><select className="select-control" value={settings.style} onChange={event => setSettings({ ...settings, style: event.target.value })}><option>Neutral analyst</option><option>Passionate</option><option>Explainer</option></select></label><label><span className="field-label">Language</span><input className="text-control" value={settings.language} onChange={event => setSettings({ ...settings, language: event.target.value })} /></label></div>
          <label className="field-label">Kokoro voice</label><select className="select-control" value={settings.voice} onChange={event => setSettings({ ...settings, voice: event.target.value as KokoroVoice })}><option value="af_heart">Heart · feminine, US</option><option value="af_bella">Bella · feminine, US</option><option value="af_nicole">Nicole · feminine, US</option><option value="am_adam">Adam · masculine, US</option><option value="am_michael">Michael · masculine, US</option><option value="bf_emma">Emma · feminine, UK</option><option value="bm_george">George · masculine, UK</option></select>
          <div className="settings-grid"><label><span className="field-label">Preview speed · {settings.speed.toFixed(1)}×</span><input className="range-control" type="range" min=".6" max="1.5" step=".1" value={settings.speed} onChange={event => setSettings({ ...settings, speed: Number(event.target.value) })} /></label><label><span className="field-label">Preview pitch · {settings.pitch.toFixed(1)}</span><input className="range-control" type="range" min=".6" max="1.5" step=".1" value={settings.pitch} onChange={event => setSettings({ ...settings, pitch: Number(event.target.value) })} /></label></div>
          <div className="panel-separator" />
          <div className="youtube-settings-heading"><span className="eyebrow">YOUTUBE CHANNEL UPLOAD</span>{youtubeChannel && <span className="connected-pill"><span /> Connected</span>}</div>
          <p className="youtube-settings-note">Connect your own channel to publish a locally rendered MP4 through Google’s official API. This does not import or download YouTube reference videos. Set up a Google OAuth web client with the YouTube Data API enabled; the client ID is public and the access token stays in memory.</p>
          <label className="field-label">Google OAuth web client ID</label><input className="text-control" type="text" autoComplete="off" value={settings.youtubeClientId} onChange={event => { disconnectYouTube(); setSettings({ ...settings, youtubeClientId: event.target.value }) }} placeholder="000000000000-abc123.apps.googleusercontent.com" />
          {youtubeChannel
            ? <div className="channel-connected"><span><BadgeCheck size={16} /> Uploading as <strong>{youtubeChannel}</strong></span><button className="button button-outline" onClick={disconnectYouTube}>Disconnect</button></div>
            : <button className="button button-outline youtube-connect" disabled={!settings.youtubeClientId.trim() || !youtubeIdentityReady || Boolean(busy)} onClick={() => void connectYouTube()}><Link2 size={14} /> {youtubeIdentityReady ? 'Connect YouTube channel' : 'Loading Google sign-in…'}</button>}
          <p className="modal-footnote">Google may require OAuth consent-screen setup and test-user approval. Videos are uploaded directly from this browser; VAR Studio does not receive your channel token.</p>
          <p className="modal-footnote">Neural voiceover uses Kokoro WASM/ONNX downloaded on first use. Web Speech is available for lightweight preview. Keys never enter project archives.</p>
          <div className="modal-actions"><button className="button button-primary" onClick={() => setActiveModal(null)}><Check size={14} /> Done</button></div>
        </div>}
        {activeModal === 'export' && <div className="modal-content">
          <div className="privacy-callout"><Film size={17} /><span><strong>Browser-based FFmpeg</strong><small>H.264 + AAC, encoded locally at 1080p from the imported file shown below. A YouTube reference link is never used as source footage. Timeline annotations, caption burn-in, trims and generated voiceover are not composited into this render.</small></span></div>
          <div className="export-stats"><div><span>OUTPUT</span><strong>{project.aspect === '16:9' ? '1920 × 1080' : '1080 × 1920'}</strong></div><div><span>CODEC</span><strong>H.264 + AAC</strong></div><div><span>FILE</span><strong>{selectedAsset?.name ?? 'No video selected'}</strong></div></div>
          {project.aspect === '9:16' && <div className="warning-banner compact"><Clock3 size={14} /> Vertical Shorts export has a 60-second limit.</div>}
          <label className="check-row"><input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} /><span>I own or have permission to use all footage in this video, including for publication on YouTube, and my use complies with applicable law.</span></label>
          <div className="export-secondary"><button onClick={() => downloadScript()}><ArrowDownToLine size={14} /> Script .txt</button><button onClick={() => downloadText(`${project.name.replace(/[^\w-]+/g, '-')}.srt`, captionsToSrt(project.captions), 'text/srt;charset=utf-8')}><Captions size={14} /> Captions .srt</button><button onClick={downloadThumbnail}><Image size={14} /> Thumbnail frame</button><button onClick={() => void exportProjectZip()}><FileArchive size={14} /> Project .zip</button><button onClick={() => downloadText(`${project.name.replace(/[^\w-]+/g, '-')}-description.txt`, projectSummary(project))}><PenLine size={14} /> Chapters .txt</button></div>
          <div className="youtube-publish">
            <div className="youtube-publish-heading"><div><span className="eyebrow">PUBLISH TO YOUTUBE</span><strong>{youtubeChannel ? `Channel: ${youtubeChannel}` : 'Connect your channel in Settings'}</strong></div><span className="youtube-lock"><LockKeyhole size={13} /> Official API</span></div>
            <p className="youtube-settings-note">Uploads only the rendered MP4 from this session, never the reference video. Confirm you have rights to all footage before rendering or publishing.</p>
            <label className="field-label">Video title</label><input className="text-control" maxLength={100} value={youtubeTitle} onChange={event => setYoutubeTitle(event.target.value)} placeholder="Title (up to 100 characters)" />
            <label className="field-label">Description</label><textarea className="text-control youtube-description" maxLength={5000} value={youtubeDescription} onChange={event => setYoutubeDescription(event.target.value)} placeholder="Optional video description and incident chapters" />
            <label className="field-label">Visibility</label><select className="select-control" value={youtubePrivacy} onChange={event => setYoutubePrivacy(event.target.value as 'private' | 'unlisted' | 'public')}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select>
            {renderedVideoIsCurrent && renderedVideo && <p className="render-ready-note"><Check size={13} /> Current render ready · {formatBytes(renderedVideo.size)}. Held in memory until this page closes.</p>}
            {renderedVideo && !renderedVideoIsCurrent && <p className="youtube-settings-note">The selected footage or aspect ratio changed after the last render. Render again to publish the current edit.</p>}
            <button className="button button-youtube" disabled={!renderedVideoIsCurrent || !youtubeToken || !rightsConfirmed || Boolean(busy)} onClick={() => void publishToYouTube()}><Upload size={14} /> Upload rendered MP4 to YouTube</button>
          </div>
          <div className="modal-actions"><button className="button button-outline" onClick={() => { void saveProjectNow(); void exportProjectZip() }}><FileArchive size={14} />Save & package</button><button className="button button-primary" disabled={!selectedAsset || !rightsConfirmed || shortTooLong || Boolean(busy)} onClick={() => void startExport()}><Download size={14} /> {renderedVideo ? 'Render again' : 'Render MP4'}</button></div>
        </div>}
        {activeModal === 'help' && <div className="modal-content help-content">
          <p>Review imported files only; the YouTube reference is an embed for scouting and cannot be rendered into your export.</p>
          <div className="shortcut-list"><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd> <kbd>→</kbd> Step one second</span><span><kbd>Shift</kbd> + arrow Step five seconds</span><span><kbd>M</kbd> Add offside marker</span><span><kbd>S</kbd> Split at playhead</span><span><kbd>Ctrl</kbd> + <kbd>Z</kbd> Undo</span><span><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> Redo</span></div>
          <button className="button button-outline full-button" onClick={() => { void exportProjectZip(); setActiveModal(null) }}><FileArchive size={14} /> Export project with media</button>
          <p className="modal-footnote">Local persistence uses IndexedDB; media size is limited by your browser and device storage. Save archives for backups and move them between devices.</p>
        </div>}
      </section></div>}
    </main>
  )
}

function readVideoMetadata(file: File): Promise<{ duration: number; width: number; height: number; thumbnail?: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, Math.max(0, video.duration / 2))
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 192
        canvas.height = Math.max(1, Math.round(192 * video.videoHeight / video.videoWidth))
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        resolve({ duration: Number.isFinite(video.duration) ? video.duration : 0, width: video.videoWidth, height: video.videoHeight, thumbnail: canvas.toDataURL('image/jpeg', .65) })
      } catch { resolve({ duration: Number.isFinite(video.duration) ? video.duration : 0, width: video.videoWidth, height: video.videoHeight }) }
      finally { URL.revokeObjectURL(url) }
    }
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} could not be read by this browser. Try MP4/H.264 or WebM.`)) }
    video.src = url
  })
}

async function decodeMonoAudio(file: Blob): Promise<Float32Array> {
  const inputContext = new AudioContext()
  try {
    const decoded = await inputContext.decodeAudioData(await file.arrayBuffer())
    const sampleRate = 16_000
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * sampleRate)), sampleRate)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const mono = await offline.startRendering()
    return mono.getChannelData(0)
  } finally {
    await inputContext.close()
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function youtubeEmbed(url: string) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (parsed.protocol !== 'https:' || !['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return ''
    const segments = parsed.pathname.split('/').filter(Boolean)
    const id = host === 'youtu.be'
      ? segments[0]
      : parsed.pathname === '/watch'
        ? parsed.searchParams.get('v')
        : ['embed', 'shorts', 'live'].includes(segments[0] || '') ? segments[1] : ''
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : ''
  } catch { return '' }
}

export default App
