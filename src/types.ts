export type Device = 'desktop' | 'mobile';
export type ViewMode = 'split' | 'slider' | 'diff';
export type InspectTab = 'visual' | 'console' | 'network' | 'seo';
export type Message = { level: string; text: string };
export type FailedRequest = { url: string; status: number; type: string; error?: string };
export type Capture = {
  documentHeight?: number;
  captureHeight?: number;
  truncated?: boolean;
  renderHealth?: {
    stylesheetCount: number;
    pendingStylesheets: number;
    failedFonts: number;
    fontStatus: string;
    brokenImages: number;
  };
  metadata: Record<string, string>;
  messages: Message[];
  requests: FailedRequest[];
  warnings: string[];
  status: number;
  finalUrl: string;
  elapsedMs: number;
};
export type Comparison = {
  captureMode?: 'fullPage';
  imageSize?: { width: number; height: number };
  imageQuality?: number;
  path: string;
  device: Device;
  viewport: { width: number; height: number };
  images: { before: string; after: string; diff: string };
  changedPixels: number;
  diffPercent: number;
  before: Capture;
  after: Capture;
  seoChanges: { key: string; before: string; after: string }[];
  newMessages: Message[];
  newRequests: FailedRequest[];
  capturedAt: string;
};
export type PageResult = {
  id: string;
  path: string;
  device: Device;
  state: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  comparison?: Comparison;
  error?: string;
  intended?: boolean;
};
export type Settings = {
  requiresUrlParameters?: boolean;
  requiresHeaders?: boolean;
  beforeUrl: string;
  afterUrl: string;
  paths: string;
  desktop: boolean;
  mobile: boolean;
  masks: string;
  threshold: number;
  demo: boolean;
};
export type Report = {
  id: string;
  createdAt: string;
  name: string;
  settings: Settings;
  pages: PageResult[];
};

export type HeaderEntry = { id: string; name: string; value: string };
export type CustomHeaders = { before: HeaderEntry[]; after: HeaderEntry[] };
