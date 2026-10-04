export interface YouTubeVideoMetadata {
  title: string
  description: string
  privacyStatus: 'private' | 'unlisted' | 'public'
}

export interface YouTubeChannel {
  id: string
  title: string
  customUrl?: string
}

interface GoogleTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (options: {
            client_id: string
            scope: string
            callback: (response: GoogleTokenResponse) => void
            error_callback?: (error: { type?: string; message?: string }) => void
          }) => GoogleTokenClient
          revoke: (token: string, callback?: () => void) => void
        }
      }
    }
  }
}

let googleScriptPromise: Promise<void> | undefined

async function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google Identity Services did not initialize.'))
      script.onerror = () => reject(new Error('Could not load Google Identity Services. Check your connection and content blockers.'))
      document.head.append(script)
    }).catch(error => {
      googleScriptPromise = undefined
      throw error
    })
  }
  await googleScriptPromise
}

export function preloadYouTubeIdentity() {
  return loadGoogleIdentity()
}

export function authorizeYouTube(clientId: string): Promise<string> {
  if (!clientId.trim()) throw new Error('Add your Google OAuth web client ID in Settings.')
  if (!clientId.trim().endsWith('.apps.googleusercontent.com')) throw new Error('The client ID should be a Google OAuth web application client ID.')
  const oauth = window.google?.accounts?.oauth2
  if (!oauth) throw new Error('Google authorization is unavailable in this browser.')

  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: clientId.trim(),
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      callback: response => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'YouTube authorization was not granted.'))
          return
        }
        resolve(response.access_token)
      },
      error_callback: error => reject(new Error(error.message || 'Google authorization window failed to open.')),
    })
    client.requestAccessToken({ prompt: 'consent' })
  })
}

export function revokeYouTubeToken(token: string) {
  const oauth = window.google?.accounts?.oauth2
  if (oauth) oauth.revoke(token)
}

export async function getConnectedYouTubeChannel(token: string): Promise<YouTubeChannel> {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const detail = await response.text()
    if (response.status === 401) throw new Error('YouTube authorization expired. Connect your channel again.')
    throw new Error(`Could not verify the connected YouTube channel (${response.status}): ${detail.slice(0, 300)}`)
  }
  const data = await response.json() as { items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string } }> }
  const channel = data.items?.[0]
  if (!channel?.id || !channel.snippet?.title) throw new Error('This Google account does not have an accessible YouTube channel.')
  return { id: channel.id, title: channel.snippet.title, customUrl: channel.snippet.customUrl }
}

export async function uploadToYouTube(
  token: string,
  file: Blob,
  metadata: YouTubeVideoMetadata,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
): Promise<string> {
  if (!file.size) throw new Error('The rendered MP4 is empty.')
  if (!metadata.title.trim()) throw new Error('Enter a video title before uploading.')
  if (metadata.title.trim().length > 100) throw new Error('YouTube video titles are limited to 100 characters.')
  if (metadata.description.length > 5000) throw new Error('YouTube video descriptions are limited to 5,000 characters.')
  const endpoint = new URL('https://www.googleapis.com/upload/youtube/v3/videos')
  endpoint.searchParams.set('uploadType', 'resumable')
  endpoint.searchParams.set('part', 'snippet,status')

  const init = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(file.size),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: { title: metadata.title.trim(), description: metadata.description },
      status: { privacyStatus: metadata.privacyStatus, selfDeclaredMadeForKids: false },
    }),
  })
  if (!init.ok) {
    const detail = await init.text()
    if (init.status === 401) throw new Error('YouTube authorization expired. Connect your channel again.')
    throw new Error(`YouTube upload could not start (${init.status}): ${detail.slice(0, 400)}`)
  }
  const uploadUrl = init.headers.get('Location')
  if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL. Check OAuth client CORS/referrer settings and try again.')

  const chunkSize = 8 * 1024 * 1024
  let offset = 0
  let videoId = ''
  while (offset < file.size) {
    if (signal.aborted) throw new DOMException('YouTube upload was cancelled. The rendered file is still available to download.', 'AbortError')
    const end = Math.min(offset + chunkSize, file.size)
    const chunk = file.slice(offset, end)
    const response = await sendChunk(uploadUrl, chunk, offset, end, file.size, signal)
    if (response.status === 308) {
      const range = response.range?.match(/bytes=0-(\d+)/)
      offset = range ? Number(range[1]) + 1 : end
      onProgress(Math.min(1, offset / file.size))
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 401) throw new Error('YouTube authorization expired. Connect your channel again.')
      throw new Error(`YouTube upload failed (${response.status}): ${response.body.slice(0, 400)}`)
    }
    try {
      const result = JSON.parse(response.body) as { id?: string }
      if (!result.id) throw new Error('YouTube returned a response without a video ID.')
      videoId = result.id
    } catch (error) {
      throw error instanceof Error ? error : new Error('YouTube returned an invalid upload response.')
    }
    offset = end
    onProgress(1)
  }
  if (!videoId) throw new Error('YouTube did not confirm the completed video upload.')
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

function sendChunk(url: string, chunk: Blob, start: number, end: number, total: number, signal: AbortSignal) {
  return new Promise<{ status: number; body: string; range: string | null }>((resolve, reject) => {
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    request.open('PUT', url)
    request.setRequestHeader('Content-Type', 'video/mp4')
    request.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${total}`)
    request.onload = () => {
      signal.removeEventListener('abort', abort)
      resolve({ status: request.status, body: request.responseText, range: request.getResponseHeader('Range') })
    }
    request.onerror = () => {
      signal.removeEventListener('abort', abort)
      reject(new Error('Network error while uploading to YouTube. The rendered file is still available to download.'))
    }
    request.onabort = () => {
      signal.removeEventListener('abort', abort)
      reject(new DOMException('YouTube upload was cancelled. The rendered file is still available to download.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    request.send(chunk)
  })
}
