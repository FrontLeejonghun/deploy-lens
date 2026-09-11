import { useEffect, useRef, useState } from 'react';
import type { CustomHeaders, HeaderEntry } from '@/types';
import type { FormEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  Columns2,
  ExternalLink,
  FileImage,
  Focus,
  Globe2,
  History,
  Image,
  Layers2,
  LoaderCircle,
  Maximize2,
  Monitor,
  MousePointer2,
  Network,
  Plus,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Square,
  Terminal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  Comparison,
  Device,
  InspectTab,
  PageResult,
  Report,
  Settings,
  ViewMode,
} from '@/types';
import { listReports, removeReport, saveReport } from '@/storage';
import { downloadReport } from '@/export';

const INITIAL_SETTINGS: Settings = {
  beforeUrl: '',
  afterUrl: '',
  paths: '/\n/pricing\n/about',
  desktop: true,
  mobile: true,
  masks: '',
  threshold: 0.1,
  demo: false,
};
const DEMO_SETTINGS: Settings = {
  ...INITIAL_SETTINGS,
  beforeUrl: 'https://forma.example',
  afterUrl: 'https://preview.forma.example',
  demo: true,
};
const META_LABELS: Record<string, string> = {
  title: '페이지 제목',
  description: '설명',
  canonical: '대표 URL',
  robots: '검색엔진 지시',
  h1: '주요 제목',
  lang: '문서 언어',
};
const shortHost = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const hasChanges = (page: PageResult) =>
  !!page.comparison &&
  (page.comparison.changedPixels > 0 ||
    page.comparison.seoChanges.length > 0 ||
    page.comparison.newMessages.length > 0 ||
    page.comparison.newRequests.length > 0);

export function App() {
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [device, setDevice] = useState<Device>('desktop');
  const [mode, setMode] = useState<ViewMode>('split');
  const [tab, setTab] = useState<InspectTab>('visual');
  const [slider, setSlider] = useState(50);
  const [zoom, setZoom] = useState(100);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [customHeaders, setCustomHeaders] = useState<CustomHeaders>({ before: [], after: [] });
  const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    void listReports()
      .then((items) => {
        if (!mountedRef.current) return;
        setHistory(items);
        if (items[0]) {
          setReport(items[0]);
          setSelectedId(items[0].pages[0]?.id ?? '');
          setDevice(items[0].pages[0]?.device ?? 'desktop');
        }
      })
      .catch(() => setNotice('브라우저 저장 공간을 사용할 수 없어 이번 비교만 표시합니다.'));
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const pages =
    report?.pages.filter((page) => page.device === device && page.path.includes(filter)) ?? [];
  const selected = report?.pages.find((page) => page.id === selectedId) ?? pages[0];
  const comparison = selected?.comparison;
  const renderWarning =
    comparison &&
    [...comparison.before.warnings, ...comparison.after.warnings].some((warning) =>
      /CSS|폰트/.test(warning),
    );
  const doneCount =
    report?.pages.filter((page) => ['done', 'error', 'cancelled'].includes(page.state)).length ?? 0;
  const changedCount = report?.pages.filter(hasChanges).length ?? 0;
  const intendedCount = report?.pages.filter((page) => page.intended).length ?? 0;
  const errorCount = report?.pages.filter((page) => page.state === 'error').length ?? 0;
  const completedCount = report?.pages.filter((page) => page.state === 'done').length ?? 0;
  const progress = report?.pages.length ? (doneCount / report.pages.length) * 100 : 0;

  async function persist(next: Report) {
    try {
      await saveReport(next);
      const items = await listReports();
      if (mountedRef.current) setHistory(items);
    } catch {
      if (mountedRef.current)
        setNotice('저장 공간이 부족합니다. HTML 보고서를 내려받아 보관하세요.');
    }
  }

  async function run(nextSettings: Settings, headers: CustomHeaders = { before: [], after: [] }) {
    if (running) return;
    const paths = [
      ...new Set(
        nextSettings.paths
          .split('\n')
          .map((path) => path.trim())
          .filter(Boolean),
      ),
    ];
    if (!paths.length || paths.length > 5 || paths.some((path) => !/^\/(?!\/)[^\\]*$/.test(path))) {
      setNotice('/로 시작하는 페이지 경로를 1~5개 입력하세요.');
      return;
    }
    const devices: Device[] = [
      ...(nextSettings.desktop ? ['desktop' as const] : []),
      ...(nextSettings.mobile ? ['mobile' as const] : []),
    ];
    if (!devices.length) {
      setNotice('화면 크기를 하나 이상 선택하세요.');
      return;
    }
    const requestHeaders = {
      before: headers.before.filter((header) => header.name || header.value),
      after: headers.after.filter((header) => header.name || header.value),
    };
    if (
      [...requestHeaders.before, ...requestHeaders.after].some(
        (header) => !header.name.trim() || !header.value,
      )
    ) {
      setNotice('헤더 이름과 값을 함께 입력하세요.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    let nextReport: Report = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      name: nextSettings.demo ? 'Forma 샘플 비교' : shortHost(nextSettings.beforeUrl),
      settings: {
        ...nextSettings,
        requiresHeaders: !!(requestHeaders.before.length || requestHeaders.after.length),
      },
      pages: devices.flatMap((viewport) =>
        paths.map((path) => ({
          id: crypto.randomUUID(),
          path,
          device: viewport,
          state: 'pending',
        })),
      ),
    };
    setReport(nextReport);
    setSelectedId(nextReport.pages[0].id);
    setDevice(devices[0]);
    setSettingsOpen(false);
    setCustomHeaders({ before: [], after: [] });
    setRunning(true);
    setTab('visual');
    setZoom(100);
    setFilter('');
    const updatePage = (id: string, patch: Partial<PageResult>) => {
      nextReport = {
        ...nextReport,
        pages: nextReport.pages.map((page) => (page.id === id ? { ...page, ...patch } : page)),
      };
      if (mountedRef.current) setReport(nextReport);
    };
    for (const page of nextReport.pages) {
      if (controller.signal.aborted) break;
      updatePage(page.id, { state: 'running' });
      try {
        const response = await fetch('/api/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            beforeHeaders: requestHeaders.before.map(({ name, value }) => ({
              name: name.trim(),
              value,
            })),
            afterHeaders: requestHeaders.after.map(({ name, value }) => ({
              name: name.trim(),
              value,
            })),
            beforeUrl: nextSettings.beforeUrl,
            afterUrl: nextSettings.afterUrl,
            path: page.path,
            device: page.device,
            masks: nextSettings.masks
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
            threshold: nextSettings.threshold,
            demo: nextSettings.demo,
          }),
          signal: controller.signal,
        });
        const body = (await response.json()) as Comparison & { error?: string };
        if (!response.ok) throw new Error(body.error ?? '비교 요청을 완료하지 못했습니다.');
        updatePage(page.id, { state: 'done', comparison: body });
      } catch (error) {
        if (controller.signal.aborted) break;
        updatePage(page.id, {
          state: 'error',
          error: error instanceof Error ? error.message : '비교를 완료하지 못했습니다.',
        });
      }
    }
    if (controller.signal.aborted)
      nextReport = {
        ...nextReport,
        pages: nextReport.pages.map((page) =>
          ['pending', 'running'].includes(page.state)
            ? { ...page, state: 'cancelled', error: '사용자가 비교를 중단했습니다.' }
            : page,
        ),
      };
    if (mountedRef.current) {
      setReport(nextReport);
      setRunning(false);
      setNotice(
        controller.signal.aborted
          ? '비교를 중단했습니다. 완료된 결과는 보관합니다.'
          : '비교가 끝났습니다. 변경된 부분을 확인해보세요.',
      );
    }
    await persist(nextReport);
  }

  function selectDevice(next: Device) {
    setDevice(next);
    setZoom(100);
    const match =
      report?.pages.find((page) => page.device === next && page.path === selected?.path) ??
      report?.pages.find((page) => page.device === next);
    setSelectedId(match?.id ?? '');
  }
  function toggleIntended() {
    if (!report || !selected || running) return;
    const next = {
      ...report,
      pages: report.pages.map((page) =>
        page.id === selected.id ? { ...page, intended: !page.intended } : page,
      ),
    };
    setReport(next);
    void persist(next);
  }
  const showSettings = () => {
    setCustomHeaders({ before: [], after: [] });
    setSettings(report && !report.settings.demo ? report.settings : INITIAL_SETTINGS);
    setSettingsOpen(true);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Deploy Lens 홈">
          <span className="brand-icon">
            <ScanLine size={23} />
          </span>
          <span>
            deploy<span className="brand-light">lens</span>
            <span className="brand-dot" />
          </span>
        </a>
        <div className="workspace-breadcrumb">
          <span className="top-divider" />
          <span>개인 워크스페이스</span>
          <ChevronRight size={14} />
          <strong>비교실</strong>
        </div>
        <div className="top-actions">
          <span className="local-badge">
            <span />
            결과는 내 브라우저에
          </span>
          <button className="icon-button" aria-label="사용 방법" onClick={() => setHelpOpen(true)}>
            <CircleAlert size={18} />
          </button>
          <span className="avatar">J</span>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="workspace-chip">
              <span className="small-logo">
                <Layers2 size={17} />
              </span>
              <div>
                <strong>배포 비교실</strong>
                <span>변경 사항을 선명하게</span>
              </div>
            </div>
            <button className="new-button" onClick={showSettings} disabled={running}>
              <Plus size={17} />새 비교 시작<span>↗</span>
            </button>
          </div>
          <div className="sidebar-section-title">워크스페이스</div>
          <button className="nav-item active" onClick={() => setHistoryOpen(false)}>
            <Columns2 size={17} />
            화면 비교<span className="tiny-count">{report?.pages.length ?? 0}</span>
          </button>
          <button className="nav-item" onClick={() => setHistoryOpen(true)}>
            <History size={17} />
            비교 기록
            <ChevronRight size={14} />
          </button>
          <div className="sidebar-rule" />
          <div className="sidebar-section-title">
            비교 페이지<span>{pages.length}</span>
          </div>
          {report && (
            <label className="page-search">
              <Search size={14} />
              <input
                aria-label="페이지 검색"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="경로 검색"
              />
            </label>
          )}
          <div className="page-list">
            {pages.map((page) => (
              <button
                key={page.id}
                onClick={() => {
                  setSelectedId(page.id);
                  setZoom(100);
                }}
                className={`page-item ${selected?.id === page.id ? 'selected' : ''}`}
              >
                <span
                  className={`page-status ${page.state === 'error' ? 'error' : page.intended ? 'intended' : hasChanges(page) ? 'changed' : page.state === 'done' ? 'same' : ''}`}
                >
                  {page.state === 'running' ? (
                    <LoaderCircle size={13} className="spin" />
                  ) : page.intended || (page.state === 'done' && !hasChanges(page)) ? (
                    <Check size={12} />
                  ) : (
                    <Circle size={8} />
                  )}
                </span>
                <span className="path-name">{page.path}</span>
                {page.comparison && <small>{page.comparison.diffPercent}%</small>}
                {page.state === 'pending' && <small>대기</small>}
                {page.state === 'error' && <small>실패</small>}
                {page.state === 'cancelled' && <small>중단</small>}
              </button>
            ))}
            {report && !pages.length && (
              <p className="sidebar-empty">선택한 조건의 페이지가 없어요.</p>
            )}
            {!report && (
              <div className="sidebar-empty">
                비교를 시작하면
                <br />
                페이지가 여기에 표시됩니다.
              </div>
            )}
          </div>
          <div className="sidebar-bottom">
            <div className="demo-callout">
              <div className="demo-orbit">
                <ScanLine size={22} />
              </div>
              <strong>먼저, 차이를 경험해보세요.</strong>
              <p>
                준비된 두 사이트를 촬영하고
                <br />
                변경된 부분을 찾아봅니다.
              </p>
              <button onClick={() => void run(DEMO_SETTINGS)} disabled={running}>
                샘플 비교 실행
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="sidebar-foot">
              <ShieldCheck size={14} />
              <span>서버에 비교 결과를 보관하지 않아요</span>
            </div>
          </div>
        </aside>
        <main className="main">
          <section className="page-heading">
            <div>
              <div className="heading-eyebrow">
                <span className="live-dot" />
                배포 전후, 한눈에
              </div>
              <h1>달라진 곳에, 시선을.</h1>
              <p>같은 화면, 같은 조건. 배포 전후의 차이를 확인하세요.</p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary-button compact-create"
                disabled={running}
                onClick={showSettings}
                aria-label="새 비교 만들기"
              >
                <Plus size={16} />
              </button>
              <button
                className="secondary-button compact-create"
                onClick={() => setHistoryOpen(true)}
                aria-label="저장한 비교 기록"
              >
                <History size={16} />
              </button>
              <button
                className="secondary-button export-button"
                aria-label="보고서 내보내기"
                disabled={!completedCount || running}
                onClick={() => report && downloadReport(report)}
              >
                <ArrowDownToLine size={16} />
                보고서 내보내기
              </button>
            </div>
          </section>
          <section className="environment-bar" aria-label="비교 대상">
            <div className="environment">
              <span className="environment-letter">A</span>
              <div>
                <span>
                  변경 전 <small>기준 사이트</small>
                </span>
                <strong>
                  {report ? shortHost(report.settings.beforeUrl) : '기준 사이트를 선택하세요'}
                </strong>
              </div>
            </div>
            <div className="environment-arrow">
              <ArrowRight size={19} />
            </div>
            <div className="environment">
              <span className="environment-letter after">B</span>
              <div>
                <span>
                  변경 후 <small>비교 사이트</small>
                </span>
                <strong>
                  {report ? shortHost(report.settings.afterUrl) : '변경된 사이트를 선택하세요'}
                </strong>
              </div>
            </div>
            <button
              className="icon-button settings-button"
              aria-label="비교 설정"
              disabled={running}
              onClick={showSettings}
            >
              <Settings2 size={18} />
            </button>
            <div className="environment-status">
              {running ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  <span>
                    촬영 중 {doneCount}/{report?.pages.length}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="비교 중단"
                    onClick={() => abortRef.current?.abort()}
                  >
                    <Square size={13} />
                  </button>
                </>
              ) : report ? (
                <>
                  <span className={`status-dot ${errorCount ? 'amber' : ''}`} />
                  {report.settings.demo ? '샘플 결과' : '비교 결과'}
                </>
              ) : (
                <>
                  <span className="status-dot neutral" />
                  준비 완료
                </>
              )}
            </div>
            {running && (
              <div className="progress-line" style={{ width: `${Math.max(progress, 3)}%` }} />
            )}
          </section>
          {running && (
            <div className="mobile-progress">
              <span>
                <LoaderCircle size={13} className="spin" />
                촬영 중 {doneCount}/{report?.pages.length}
              </span>
              <button onClick={() => abortRef.current?.abort()}>
                <Square size={12} />
                중단
              </button>
            </div>
          )}
          {report ? (
            <>
              <section className="summary-strip">
                <div>
                  <span className="summary-icon">
                    <Layers2 size={17} />
                  </span>
                  <span>완료된 화면</span>
                  <strong>
                    {completedCount}
                    <small> / {report.pages.length}</small>
                  </strong>
                </div>
                <div>
                  <span className="summary-icon pink">
                    <Focus size={17} />
                  </span>
                  <span>변경 감지</span>
                  <strong>{changedCount}</strong>
                </div>
                <div>
                  <span className="summary-icon green">
                    <CheckCheck size={17} />
                  </span>
                  <span>의도한 변경</span>
                  <strong>{intendedCount}</strong>
                </div>
                <div className="summary-note">
                  <ShieldCheck size={15} />
                  <span>
                    {errorCount
                      ? `${errorCount}개 화면 촬영 실패`
                      : '화면 차이가 오류를 의미하지는 않아요'}
                  </span>
                </div>
              </section>
              <section className="comparison-workspace">
                <div className="comparison-toolbar">
                  <div className="current-path">
                    <Globe2 size={16} />
                    <select
                      aria-label="비교 페이지 선택"
                      value={selected?.id ?? ''}
                      onChange={(event) => {
                        setSelectedId(event.target.value);
                        setZoom(100);
                      }}
                      className="path-select"
                    >
                      {report.pages
                        .filter((page) => page.device === device)
                        .map((page) => (
                          <option key={page.id} value={page.id}>
                            {page.path}
                          </option>
                        ))}
                    </select>
                    {renderWarning ? (
                      <span className="tag amber">촬영 확인 필요</span>
                    ) : selected?.intended ? (
                      <span className="tag green">의도한 변경</span>
                    ) : comparison ? (
                      <span className={`tag ${hasChanges(selected!) ? 'pink' : 'green'}`}>
                        {hasChanges(selected!) ? '변경 감지' : '변경 없음'}
                      </span>
                    ) : (
                      <span className="tag">
                        {selected?.state === 'running'
                          ? '촬영 중'
                          : selected?.state === 'error'
                            ? '촬영 실패'
                            : selected?.state === 'cancelled'
                              ? '중단'
                              : '대기'}
                      </span>
                    )}
                  </div>
                  <div className="device-switch" aria-label="화면 크기">
                    <button
                      className={device === 'desktop' ? 'selected' : ''}
                      aria-pressed={device === 'desktop'}
                      aria-label="데스크톱"
                      onClick={() => selectDevice('desktop')}
                      disabled={!report.settings.desktop}
                    >
                      <Monitor size={15} />
                      <span>데스크톱</span>
                    </button>
                    <button
                      className={device === 'mobile' ? 'selected' : ''}
                      aria-pressed={device === 'mobile'}
                      aria-label="모바일"
                      onClick={() => selectDevice('mobile')}
                      disabled={!report.settings.mobile}
                    >
                      <Smartphone size={15} />
                      <span>모바일</span>
                    </button>
                  </div>
                </div>
                <div className="inspect-tabs" role="tablist" aria-label="비교 항목">
                  {(
                    [
                      {
                        id: 'visual',
                        label: '화면',
                        icon: Image,
                        count: comparison ? `${comparison.diffPercent}%` : undefined,
                      },
                      {
                        id: 'console',
                        label: '콘솔',
                        icon: Terminal,
                        count: comparison?.newMessages.length,
                      },
                      {
                        id: 'network',
                        label: '네트워크',
                        icon: Network,
                        count: comparison?.newRequests.length,
                      },
                      {
                        id: 'seo',
                        label: 'SEO',
                        icon: Globe2,
                        count: comparison?.seoChanges.length,
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      role="tab"
                      aria-selected={tab === item.id}
                      onClick={() => setTab(item.id)}
                      className={tab === item.id ? 'active' : ''}
                    >
                      <item.icon size={15} />
                      {item.label}
                      {item.count !== undefined && (
                        <span className={Number(item.count) > 0 ? 'has-count' : ''}>
                          {item.count}
                        </span>
                      )}
                    </button>
                  ))}
                  <div className="capture-detail">
                    {comparison
                      ? `${comparison.viewport.width} × ${comparison.viewport.height}`
                      : '전체 페이지 촬영'}
                    <span />
                    동일 조건
                  </div>
                </div>
                {comparison ? (
                  tab === 'visual' ? (
                    <>
                      <div className="viewer-toolbar">
                        <div className="view-mode">
                          {(
                            [
                              { id: 'split', label: '나란히', icon: Columns2 },
                              { id: 'slider', label: '슬라이더', icon: ArrowLeftRight },
                              { id: 'diff', label: '차이 강조', icon: Focus },
                            ] as const
                          ).map((item) => (
                            <button
                              key={item.id}
                              className={mode === item.id ? 'selected' : ''}
                              aria-pressed={mode === item.id}
                              onClick={() => {
                                setMode(item.id);
                                setZoom(100);
                              }}
                            >
                              <item.icon size={14} />
                              {item.label}
                            </button>
                          ))}
                        </div>
                        <div className="zoom-control">
                          <button
                            className="icon-button"
                            aria-label="축소"
                            disabled={zoom <= 100}
                            onClick={() => setZoom((value) => Math.max(100, value - 25))}
                          >
                            <ZoomOut size={15} />
                          </button>
                          <button
                            className="zoom-value"
                            onClick={() => setZoom(100)}
                            title="화면에 맞추기"
                          >
                            {zoom}%<ChevronDown size={12} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="확대"
                            disabled={zoom >= 200}
                            onClick={() => setZoom((value) => Math.min(200, value + 25))}
                          >
                            <ZoomIn size={15} />
                          </button>
                          <span className="tool-divider" />
                          <button
                            className="icon-button"
                            aria-label="비교 화면 전체화면"
                            onClick={() => {
                              if (document.fullscreenElement) void document.exitFullscreen();
                              else
                                void viewerRef.current
                                  ?.requestFullscreen()
                                  .catch(() =>
                                    setNotice('이 브라우저에서는 전체화면을 지원하지 않습니다.'),
                                  );
                            }}
                          >
                            <Maximize2 size={15} />
                          </button>
                        </div>
                      </div>
                      <div
                        className={`viewer-surface ${device} ${mode}`}
                        ref={viewerRef}
                        tabIndex={0}
                        aria-label="촬영 결과 스크롤 영역"
                      >
                        <div className="viewer-content" style={{ width: `${zoom}%` }}>
                          {mode === 'split' ? (
                            <div className="split-grid">
                              <BrowserFrame
                                label="변경 전"
                                letter="A"
                                host={shortHost(report.settings.beforeUrl)}
                                image={comparison.images.before}
                              />
                              <BrowserFrame
                                label="변경 후"
                                letter="B"
                                host={shortHost(report.settings.afterUrl)}
                                image={comparison.images.after}
                              />
                            </div>
                          ) : (
                            <div className="single-frame">
                              <div className="browser-frame-head">
                                <span className="traffic-lights">
                                  <i />
                                  <i />
                                  <i />
                                </span>
                                <span>
                                  {mode === 'slider'
                                    ? '변경 전 ↔ 변경 후'
                                    : '분홍색으로 표시한 부분이 달라졌어요'}
                                </span>
                                <span className="frame-version">
                                  {mode === 'slider' ? 'A / B' : 'DIFF'}
                                </span>
                              </div>
                              <div className="image-stack">
                                <img
                                  alt={
                                    mode === 'diff' ? '변경된 부분을 강조한 화면' : '변경 후 화면'
                                  }
                                  src={
                                    mode === 'diff'
                                      ? comparison.images.diff
                                      : comparison.images.after
                                  }
                                />
                                {mode === 'slider' && (
                                  <>
                                    <img
                                      className="before-layer"
                                      alt="변경 전 화면"
                                      src={comparison.images.before}
                                      style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}
                                    />
                                    <div className="slider-line" style={{ left: `${slider}%` }}>
                                      <span>
                                        <ArrowLeftRight size={18} />
                                      </span>
                                    </div>
                                    <input
                                      className="comparison-slider"
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={slider}
                                      aria-label="변경 전후 비교 슬라이더"
                                      onChange={(event) => setSlider(Number(event.target.value))}
                                    />
                                    <span className="image-corner before">변경 전</span>
                                    <span className="image-corner after">변경 후</span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="viewer-hint">
                          <MousePointer2 size={13} />
                          {mode === 'slider'
                            ? '좌우로 드래그해 비교하고, 스크롤해 아래 내용을 확인하세요'
                            : mode === 'diff'
                              ? '분홍색 영역: 허용 오차를 넘는 픽셀 차이'
                              : '화면 위에서 스크롤하면 변경 전후가 함께 움직여요'}
                        </div>
                      </div>
                      <div className="comparison-footer">
                        <div>
                          <span
                            className={comparison.changedPixels ? 'status-dot rose' : 'status-dot'}
                          />
                          <strong>{comparison.diffPercent}%</strong>
                          <span>픽셀이 달라졌어요</span>
                          <small>{comparison.changedPixels.toLocaleString()} px</small>
                        </div>
                        <button
                          className={`review-button ${selected?.intended ? 'reviewed' : ''}`}
                          disabled={running || !selected || !hasChanges(selected)}
                          onClick={toggleIntended}
                        >
                          <CheckCheck size={16} />
                          {selected?.intended ? '의도한 변경으로 확인됨' : '의도한 변경으로 표시'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <InspectionPanel tab={tab} comparison={comparison} />
                  )
                ) : (
                  <div className="capture-state">
                    {selected?.state === 'error' || selected?.state === 'cancelled' ? (
                      <>
                        <CircleAlert size={34} />
                        <h3>
                          {selected.state === 'error'
                            ? '이 화면을 촬영하지 못했어요'
                            : '이 화면의 비교를 중단했어요'}
                        </h3>
                        <p>{selected.error}</p>
                        <button
                          className="secondary-button"
                          disabled={running}
                          onClick={() => {
                            setSettings(report.settings);
                            setSettingsOpen(true);
                          }}
                        >
                          설정 확인하기
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="scan-illustration">
                          <ScanLine size={38} />
                          {running && <span />}
                        </div>
                        <h3>
                          {selected?.state === 'running'
                            ? '같은 조건으로 두 화면을 촬영하고 있어요'
                            : '차례가 되면 촬영을 시작해요'}
                        </h3>
                        <p>
                          페이지를 스크롤해 콘텐츠를 불러온 뒤 전체 화면과 오류 정보를 수집합니다.
                        </p>
                        <div className="capture-steps">
                          <span>
                            <Check size={12} />
                            화면 크기 통일
                          </span>
                          <span>
                            <Check size={12} />
                            애니메이션 정지
                          </span>
                          <span>
                            <LoaderCircle size={12} className={running ? 'spin' : ''} />
                            화면 비교
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>
              {!!comparison &&
                [...comparison.before.warnings, ...comparison.after.warnings].length > 0 && (
                  <details className="capture-warning">
                    <summary>
                      <CircleAlert size={14} />
                      촬영 참고 사항{' '}
                      {new Set([...comparison.before.warnings, ...comparison.after.warnings]).size}
                      개
                    </summary>
                    {[
                      ...new Set([...comparison.before.warnings, ...comparison.after.warnings]),
                    ].map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </details>
                )}
              <div className="workspace-footer">
                <span>
                  <ShieldCheck size={13} />
                  브라우저에만 결과 저장
                </span>
                <span>
                  {dateLabel(report.createdAt)}에 시작 ·{' '}
                  {comparison?.captureMode === 'fullPage'
                    ? `전체 페이지 ${comparison.imageSize?.height.toLocaleString()}px`
                    : '이전 첫 화면 촬영 기록'}
                </span>
              </div>
            </>
          ) : (
            <Welcome onDemo={() => void run(DEMO_SETTINGS)} onCreate={showSettings} />
          )}
        </main>
      </div>
      {settingsOpen && (
        <Modal
          title="새로운 비교"
          subtitle="두 주소를 입력하고, 같은 조건에서 확인하세요."
          onClose={() => {
            setSettingsOpen(false);
            setCustomHeaders({ before: [], after: [] });
          }}
        >
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void run(settings, customHeaders);
            }}
          >
            <div className="url-form-grid">
              <label>
                <span>
                  <b className="field-letter">A</b>변경 전 URL
                </span>
                <input
                  type="url"
                  required
                  placeholder="https://your-site.com"
                  value={settings.beforeUrl}
                  onChange={(event) =>
                    setSettings({ ...settings, beforeUrl: event.target.value, demo: false })
                  }
                />
              </label>
              <label>
                <span>
                  <b className="field-letter purple">B</b>변경 후 URL
                </span>
                <input
                  type="url"
                  required
                  placeholder="https://your-preview.vercel.app"
                  value={settings.afterUrl}
                  onChange={(event) =>
                    setSettings({ ...settings, afterUrl: event.target.value, demo: false })
                  }
                />
              </label>
            </div>
            <details className="custom-headers" open={settings.requiresHeaders || undefined}>
              <summary>
                <ShieldCheck size={15} />
                커스텀 헤더 <small>배포 보호·인증</small>
                <ChevronDown size={14} />
              </summary>
              <p>변경 전과 변경 후에 각각 설정할 수 있어요. 값은 이번 실행에만 사용합니다.</p>
              {settings.requiresHeaders && (
                <div className="headers-notice">
                  이 기록은 인증 헤더를 사용했습니다. 재실행하려면 값을 다시 입력하세요.
                </div>
              )}
              <HeaderEditor
                label="A · 변경 전"
                entries={customHeaders.before}
                onChange={(entries) => setCustomHeaders({ ...customHeaders, before: entries })}
              />
              <HeaderEditor
                label="B · 변경 후"
                entries={customHeaders.after}
                onChange={(entries) => setCustomHeaders({ ...customHeaders, after: entries })}
              />
              <div className="headers-privacy">
                <ShieldCheck size={13} />
                입력한 출처에만 전송 · 설정값은 기록·보고서에 저장하지 않음
              </div>
            </details>
            {settings.demo && (
              <div className="form-note">
                샘플 사이트를 다시 비교합니다. URL을 수정하면 실제 사이트 비교로 전환됩니다.
              </div>
            )}
            <label className="form-label">
              비교할 페이지 <small>한 줄에 하나씩, 최대 5개</small>
              <textarea
                rows={3}
                value={settings.paths}
                onChange={(event) => setSettings({ ...settings, paths: event.target.value })}
              />
            </label>
            <fieldset>
              <legend>화면 크기</legend>
              <div className="device-options">
                <label className={settings.desktop ? 'checked' : ''}>
                  <input
                    type="checkbox"
                    checked={settings.desktop}
                    onChange={(event) =>
                      setSettings({ ...settings, desktop: event.target.checked })
                    }
                  />
                  <Monitor size={21} />
                  <span>
                    데스크톱<small>1440 × 960</small>
                  </span>
                  <Check size={16} />
                </label>
                <label className={settings.mobile ? 'checked' : ''}>
                  <input
                    type="checkbox"
                    checked={settings.mobile}
                    onChange={(event) => setSettings({ ...settings, mobile: event.target.checked })}
                  />
                  <Smartphone size={21} />
                  <span>
                    모바일<small>390 × 844</small>
                  </span>
                  <Check size={16} />
                </label>
              </div>
            </fieldset>
            <details className="advanced-settings">
              <summary>
                <SlidersHorizontal size={15} />
                세부 설정
                <ChevronDown size={14} />
              </summary>
              <label className="form-label">
                비교에서 제외할 영역 <small>CSS 선택자, 한 줄에 하나</small>
                <textarea
                  rows={2}
                  placeholder={'.live-clock\n[data-testid="random-banner"]'}
                  value={settings.masks}
                  onChange={(event) => setSettings({ ...settings, masks: event.target.value })}
                />
              </label>
              <label className="form-label">
                색상 허용 오차{' '}
                <small>{settings.threshold.toFixed(2)} · 작을수록 미세한 차이까지 감지</small>
                <input
                  type="range"
                  min="0.01"
                  max="0.5"
                  step="0.01"
                  value={settings.threshold}
                  onChange={(event) =>
                    setSettings({ ...settings, threshold: Number(event.target.value) })
                  }
                />
              </label>
            </details>
            <div className="form-note">
              <ShieldCheck size={15} />
              <span>
                전체 페이지를 스크롤하며 로딩한 뒤 최대 10,000px까지 비교합니다.
                <br />
                로그인·폼 제출 없이 조회 요청만 허용합니다.
              </span>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setSettingsOpen(false)}
              >
                취소
              </button>
              <button className="primary-button" type="submit">
                <ScanLine size={17} />
                비교 시작하기
              </button>
            </div>
          </form>
        </Modal>
      )}
      {historyOpen && (
        <Modal
          title="비교 기록"
          subtitle="이 브라우저에 저장한 최근 비교입니다."
          onClose={() => setHistoryOpen(false)}
        >
          <div className="history-list">
            {history.length ? (
              history.map((item) => (
                <div className="history-row" key={item.id}>
                  <button
                    disabled={running}
                    onClick={() => {
                      setReport(item);
                      setSelectedId(item.pages[0]?.id ?? '');
                      setDevice(item.pages[0]?.device ?? 'desktop');
                      setHistoryOpen(false);
                      setFilter('');
                    }}
                  >
                    <span className="history-icon">
                      <Layers2 size={20} />
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {dateLabel(item.createdAt)} · {item.pages.length}개 화면
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${item.name} 기록 삭제`}
                    disabled={running}
                    onClick={() => {
                      void removeReport(item.id)
                        .then(() => {
                          setHistory((items) => items.filter((other) => other.id !== item.id));
                          if (report?.id === item.id) setReport(null);
                        })
                        .catch(() => setNotice('기록을 삭제하지 못했습니다.'));
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <div className="simple-empty">
                <History size={30} />
                <p>아직 저장된 비교가 없어요.</p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {helpOpen && (
        <Modal
          title="작은 차이까지, 놓치지 않도록."
          subtitle="Deploy Lens 사용 방법"
          onClose={() => setHelpOpen(false)}
        >
          <div className="help-steps">
            <div>
              <span>1</span>
              <section>
                <h3>두 사이트의 주소를 입력하세요.</h3>
                <p>기준 사이트와 변경된 사이트, 비교할 경로를 지정합니다.</p>
              </section>
            </div>
            <div>
              <span>2</span>
              <section>
                <h3>같은 조건으로 촬영합니다.</h3>
                <p>
                  화면 크기·언어·시간대·색상 테마를 맞추고, 애니메이션을 정지합니다. URL 자체에
                  지정한 언어는 유지됩니다.
                </p>
              </section>
            </div>
            <div>
              <span>3</span>
              <section>
                <h3>달라진 부분을 검토하세요.</h3>
                <p>
                  화면과 새 콘솔 메시지, 실패 요청, SEO 변경을 살펴보세요. 의도한 변경은 별도로
                  표시할 수 있습니다.
                </p>
              </section>
            </div>
          </div>
          <div className="help-note">
            영상·랜덤 콘텐츠·로딩 시점에 따라 차이가 발생할 수 있습니다. 필요한 영역은 세부 설정에서
            제외하세요. 새로고침 전에 실행을 완료해야 결과가 저장됩니다.
          </div>
          <button className="primary-button full-width" onClick={() => setHelpOpen(false)}>
            확인했어요
          </button>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <CircleAlert size={17} />
          {notice}
          <button aria-label="알림 닫기" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function BrowserFrame({
  label,
  letter,
  host,
  image,
}: {
  label: string;
  letter: string;
  host: string;
  image: string;
}) {
  return (
    <div className="browser-frame">
      <div className="frame-label">
        <span className={`frame-letter ${letter === 'B' ? 'purple' : ''}`}>{letter}</span>
        <strong>{label}</strong>
        <span>{host}</span>
      </div>
      <div className="browser-paper">
        <div className="browser-frame-head">
          <span className="traffic-lights">
            <i />
            <i />
            <i />
          </span>
          <span>
            <Globe2 size={10} />
            {host}
          </span>
          <ExternalLink size={11} />
        </div>
        <img src={image} alt={`${label} 사이트 화면`} draggable={false} />
      </div>
    </div>
  );
}

function Welcome({ onDemo, onCreate }: { onDemo: () => void; onCreate: () => void }) {
  return (
    <section className="welcome">
      <div className="welcome-copy">
        <span className="welcome-icon">
          <Layers2 size={25} />
        </span>
        <h2>
          배포 버튼을 누르기 전,
          <br />한 번 더 확신하세요.
        </h2>
        <p>
          화면부터 콘솔, 네트워크, SEO까지.
          <br />
          흩어진 차이를 하나의 작업실에서 확인합니다.
        </p>
        <div className="welcome-actions">
          <button className="primary-button" onClick={onDemo}>
            <ScanLine size={17} />
            샘플로 체험하기
          </button>
          <button className="text-button" onClick={onCreate}>
            내 사이트 비교
            <ArrowRight size={15} />
          </button>
        </div>
        <span className="welcome-note">설치 없이 시작 · 실제 브라우저 촬영</span>
      </div>
      <div className="welcome-art" aria-hidden="true">
        <div className="art-window back">
          <div className="art-window-bar">
            <i />
            <i />
            <i />
            <span>변경 전</span>
          </div>
          <div className="mini-nav">
            <b>forma®</b>
            <span>•••</span>
          </div>
          <div className="mini-content">
            <div>
              <strong>
                생각을 모으고,
                <br />
                가능성을 열다.
              </strong>
              <i />
              <i />
              <button tabIndex={-1} />
            </div>
            <div className="mini-sculpture">
              <span />
              <i />
            </div>
          </div>
        </div>
        <div className="art-window front">
          <div className="art-window-bar">
            <i />
            <i />
            <i />
            <span>변경 후</span>
          </div>
          <div className="mini-nav">
            <b>forma®</b>
            <span>•••</span>
          </div>
          <div className="mini-content">
            <div>
              <strong>
                생각을 모으고,
                <br />
                <em>작품으로 꺼내다.</em>
              </strong>
              <i />
              <i />
              <button tabIndex={-1} />
            </div>
            <div className="mini-sculpture">
              <span />
              <i />
            </div>
          </div>
          <div className="art-diff-badge">
            <Focus size={14} />
            변경된 부분 발견
          </div>
        </div>
        <div className="art-grid" />
      </div>
      <div className="welcome-features">
        <span>
          <Columns2 size={17} />
          픽셀 단위 화면 비교
        </span>
        <span>
          <Terminal size={17} />새 오류만 모아서
        </span>
        <span>
          <Globe2 size={17} />
          SEO 변경 확인
        </span>
        <span>
          <FileImage size={17} />
          독립 HTML 보고서
        </span>
      </div>
    </section>
  );
}

function InspectionPanel({ tab, comparison }: { tab: InspectTab; comparison: Comparison }) {
  if (tab === 'seo')
    return (
      <div className="inspection-panel">
        <div className="panel-intro">
          <Globe2 size={22} />
          <div>
            <h3>페이지 메타데이터</h3>
            <p>바뀐 값은 분홍색으로 표시합니다. 두 환경의 도메인 차이도 그대로 보여줍니다.</p>
          </div>
        </div>
        <div className="seo-table">
          <div className="seo-row seo-head">
            <span>항목</span>
            <span>A · 변경 전</span>
            <span>B · 변경 후</span>
          </div>
          {Object.keys(comparison.before.metadata).map((key) => (
            <div
              key={key}
              className={`seo-row ${comparison.before.metadata[key] !== comparison.after.metadata[key] ? 'changed' : ''}`}
            >
              <strong>{META_LABELS[key] ?? key}</strong>
              <span>{comparison.before.metadata[key] || <i>설정 없음</i>}</span>
              <span>{comparison.after.metadata[key] || <i>설정 없음</i>}</span>
            </div>
          ))}
        </div>
      </div>
    );
  const isConsole = tab === 'console';
  const totalBefore = isConsole
    ? comparison.before.messages.length
    : comparison.before.requests.length;
  const totalAfter = isConsole
    ? comparison.after.messages.length
    : comparison.after.requests.length;
  const count = isConsole ? comparison.newMessages.length : comparison.newRequests.length;
  return (
    <div className="inspection-panel">
      <div className="panel-intro">
        {isConsole ? <Terminal size={22} /> : <Network size={22} />}
        <div>
          <h3>{isConsole ? '새로 발생한 콘솔 메시지' : '새로 실패한 네트워크 요청'}</h3>
          <p>
            변경 전 {totalBefore}건 → 변경 후 {totalAfter}건.{' '}
            {isConsole
              ? '기준 사이트에 없던 오류와 경고를 표시합니다.'
              : '동일 경로·응답 상태를 기준으로 비교합니다.'}
          </p>
        </div>
        <span className="panel-count">{count}건</span>
      </div>
      {count ? (
        <div className="issue-list">
          {isConsole
            ? comparison.newMessages.map((message, index) => (
                <div className="issue" key={index}>
                  <span className={`issue-tag ${message.level === 'warning' ? 'warning' : ''}`}>
                    {message.level}
                  </span>
                  <code>{message.text}</code>
                </div>
              ))
            : comparison.newRequests.map((request, index) => (
                <div className="issue" key={index}>
                  <span className="issue-tag">{request.status || '실패'}</span>
                  <div>
                    <code>{request.url}</code>
                    <small>
                      {request.type}
                      {request.error ? ` · ${request.error}` : ''}
                    </small>
                  </div>
                </div>
              ))}
        </div>
      ) : (
        <div className="clean-state">
          <span>
            <ShieldCheck size={28} />
          </span>
          <h3>새로 발견된 {isConsole ? '메시지가' : '실패 요청이'} 없어요.</h3>
          <p>이 촬영에서 관측한 결과입니다. 모든 동작을 검사한 것은 아닙니다.</p>
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function HeaderEditor({
  label,
  entries,
  onChange,
}: {
  label: string;
  entries: HeaderEntry[];
  onChange: (entries: HeaderEntry[]) => void;
}) {
  return (
    <div className="header-editor">
      <div className="header-editor-title">
        <strong>{label}</strong>
        <button
          type="button"
          disabled={entries.length >= 8}
          onClick={() => onChange([...entries, { id: crypto.randomUUID(), name: '', value: '' }])}
        >
          <Plus size={13} />
          헤더 추가
        </button>
      </div>
      {entries.length ? (
        entries.map((entry, index) => (
          <div className="header-input-row" key={entry.id}>
            <input
              aria-label={`${label} 헤더 ${index + 1} 이름`}
              placeholder="x-vercel-protection-bypass"
              value={entry.name}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  entries.map((item) =>
                    item.id === entry.id ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
            <input
              aria-label={`${label} 헤더 ${index + 1} 값`}
              type="password"
              placeholder="헤더 값"
              value={entry.value}
              maxLength={2048}
              autoComplete="new-password"
              onChange={(event) =>
                onChange(
                  entries.map((item) =>
                    item.id === entry.id ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`${label} 헤더 ${index + 1} 삭제`}
              onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))
      ) : (
        <span className="no-headers">추가한 헤더 없음</span>
      )}
    </div>
  );
}
