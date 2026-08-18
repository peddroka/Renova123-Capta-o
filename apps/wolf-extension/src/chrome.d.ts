declare const chrome: {
  storage: { local: { get(keys: string): Promise<Record<string, any>>; set(values: Record<string, any>): Promise<void>; remove(keys: string): Promise<void> }; session: { get(keys: string): Promise<Record<string, any>>; set(values: Record<string, any>): Promise<void>; remove(keys: string): Promise<void> } };
  tabs: { get(tabId: number): Promise<{ id?: number; url?: string; windowId?: number }>; query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number; url?: string; windowId?: number }>>; sendMessage(tabId: number, message: unknown): Promise<any>; create(options: { url: string }): Promise<{ id?: number }> };
  scripting: { executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown> };
  tabCapture: { capture(options: { audio: boolean; video: boolean }, callback: (stream?: MediaStream) => void): void; getMediaStreamId(options: { targetTabId: number }): Promise<string> };
  runtime: { id?: string; lastError?: { message?: string }; getURL(path: string): string; getManifest(): { version: string }; sendMessage(message: unknown): Promise<any>; onMessage: { addListener(listener: (message: any) => void): void } };
  offscreen: { createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>; closeDocument(): Promise<void> };
};
