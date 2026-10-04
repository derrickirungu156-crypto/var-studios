import { fetchFile, toBlobURL } from '@ffmpeg/util'
import type { Project } from '../types'
import { formatTime } from './ai'

export function captionsToSrt(captions: Project['captions']) {
  return captions.map((caption, index) => {
    const stamp = (time: number) => {
      const ms = Math.floor((time % 1) * 1000)
      const total = Math.floor(time)
      return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')},${String(ms).padStart(3, '0')}`
    }
    return `${index + 1}\n${stamp(caption.start)} --> ${stamp(caption.end)}\n${caption.text}\n`
  }).join('\n')
}

export function downloadText(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function renderVideo(
  project: Project,
  assetId: string,
  onProgress: (ratio: number) => void,
  onReady: (cancel: () => void) => void,
) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const ffmpeg = new FFmpeg()
  const multithreaded = window.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
  const base = multithreaded
    ? 'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/umd'
    : 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
  const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript')
  const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
  const workerURL = multithreaded
    ? await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript')
    : undefined
  await ffmpeg.load({ coreURL, wasmURL, ...(workerURL ? { workerURL } : {}) })
  ffmpeg.on('progress', ({ progress }) => onProgress(Math.min(1, Math.max(0, progress))))
  onReady(() => ffmpeg.terminate())
  const asset = project.assets.find(item => item.id === assetId)
  if (!asset) throw new Error('The selected video file is no longer available in this project.')
  const extension = asset.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'mp4'
  const input = `input.${extension}`
  const output = 'var-studio-export.mp4'
  await ffmpeg.writeFile(input, await fetchFile(asset.blob))
  const vertical = project.aspect === '9:16'
  const vf = vertical
    ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1'
    : 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1'
  await ffmpeg.exec(['-i', input, '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output])
  const data = await ffmpeg.readFile(output)
  await ffmpeg.deleteFile(input)
  await ffmpeg.deleteFile(output)
  if (typeof data === 'string') throw new Error('FFmpeg returned text instead of an encoded video.')
  return new Blob([Uint8Array.from(data)], { type: 'video/mp4' })
}

export function projectSummary(project: Project) {
  const chapters = project.incidents.map(item => `${formatTime(item.time)} ${item.type}`).join('\n')
  return `${project.name}\n${project.aspect} football VAR analysis\n\n${chapters ? `Chapters\n${chapters}\n\n` : ''}${project.youtubeNotes}`
}
