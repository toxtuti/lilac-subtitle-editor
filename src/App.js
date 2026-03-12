import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

const DEFAULT_DURATION = 3;
const FPS = 24;
const STORAGE_KEY = 'subtitleEditor_subtitles_v1';
const MAX_CPS = 25;

function secondsToTimecode(totalSeconds) {
  if (Number.isNaN(totalSeconds) || totalSeconds == null) return '00:00:00:00';
  const totalFrames = Math.max(0, Math.round(totalSeconds * FPS));
  const h = Math.floor(totalFrames / (3600 * FPS));
  const m = Math.floor((totalFrames % (3600 * FPS)) / (60 * FPS));
  const s = Math.floor((totalFrames % (60 * FPS)) / FPS);
  const f = totalFrames % FPS;
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(h,2)}:${pad(m,2)}:${pad(s,2)}:${pad(f,2)}`;
}

function secondsToSrtTime(sec) {
  const c = Math.max(0, sec || 0);
  const h = Math.floor(c/3600), m = Math.floor((c%3600)/60), s = Math.floor(c%60);
  const ms = Math.round((c - Math.floor(c)) * 1000);
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(h,2)}:${pad(m,2)}:${pad(s,2)},${pad(ms,3)}`;
}

function parseSRT(text) {
  const blocks = text.replace(/\r\n/g,'\n').split(/\n{2,}/).filter(Boolean);
  return blocks.map((block, idx) => {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines.find(l => l.includes('-->')) || '';
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    const srtToSec = (str) => {
      const [hms, ms='0'] = str.split(',');
      const [h,m,s] = hms.split(':').map(Number);
      return h*3600 + m*60 + s + Number(ms)/1000;
    };
    return {
      id: `srt-${idx}-${Date.now()}`,
      start: startStr ? srtToSec(startStr) : 0,
      end: endStr ? srtToSec(endStr) : DEFAULT_DURATION,
      text: lines.slice(lines.indexOf(timeLine)+1).join('\n')
    };
  }).sort((a,b) => a.start - b.start);
}

export default function App() {
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [subtitles, setSubtitles] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [projectName, setProjectName] = useState('vlog_2026-03-09');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [toast, setToast] = useState(null);
  const [focusedIdx, setFocusedIdx] = useState(null);
  const [panelView, setPanelView] = useState('card');

  const isFirstLoad = useRef(true);
  const videoRef = useRef(null);
  const textareaRefs = useRef([]);
  const clipRefs = useRef([]);
  const subtitlePanelRef = useRef(null);
  const lastActiveIdx = useRef(-1);
  const timelineRef = useRef(null);
  const dragState = useRef(null);
  const isPlayingRef = useRef(false);
  const focusedIdxRef = useRef(null);
  const subtitlesRef = useRef([]);
  const videoDurationRef = useRef(0);

  // ref 동기화
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { focusedIdxRef.current = focusedIdx; }, [focusedIdx]);
  useEffect(() => { subtitlesRef.current = subtitles; }, [subtitles]);
  useEffect(() => { videoDurationRef.current = videoDuration; }, [videoDuration]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // visualViewport 대응
  useEffect(() => {
    const vvp = window.visualViewport;
    if (!vvp) return;
    const onVC = () => {
      const vh = vvp.height;
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
      document.documentElement.style.setProperty('--app-offset', `${vvp.offsetTop}px`);
      document.documentElement.style.setProperty('--video-panel-max', `${Math.round(vh * 0.42)}px`);
      window.scrollTo(0, 0);
    };
    vvp.addEventListener('resize', onVC);
    vvp.addEventListener('scroll', onVC);
    onVC();
    return () => { vvp.removeEventListener('resize', onVC); vvp.removeEventListener('scroll', onVC); };
  }, []);

  // 로컬스토리지 불러오기
  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) setSubtitles(JSON.parse(raw));
  }, []);

  // 자동 저장
  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    setSaveStatus('unsaved');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subtitles));
    const t = setTimeout(() => { setSaveStatus('saved'); setLastSavedTime(new Date()); }, 800);
    return () => clearTimeout(t);
  }, [subtitles]);

  // 탭 닫기 경고
  useEffect(() => {
    const fn = (e) => { if (subtitles.length > 0) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [subtitles.length]);

  // 재생/정지 (ref 기반으로 클로저 문제 없음)
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlayingRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      const subs = subtitlesRef.current;
      const fi = focusedIdxRef.current;
      const sub = fi !== null ? subs[fi] : null;
      const playheadMatchesSub = sub && Math.abs(videoRef.current.currentTime - sub.start) < 0.1;
      if (playheadMatchesSub) {
        videoRef.current.currentTime = sub.start;
        setCurrentTime(sub.start);
      }
      lastActiveIdx.current = -1;
      videoRef.current.play();
      setIsPlaying(true);
    }
  }, []);

  // 전역 단축키 + 타임라인 휠
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      const isTyping = tag === 'TEXTAREA' || tag === 'INPUT';
      if (e.code === 'Space' && !isTyping) {
        e.preventDefault();
        togglePlay();
        return;
      }
      if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !isTyping) {
        e.preventDefault();
        const frames = e.ctrlKey || e.metaKey ? 5 : 1;
        const delta = e.code === 'ArrowLeft' ? -frames : frames;
        if (videoRef.current) {
          const t = Math.max(0, Math.min(videoDurationRef.current, videoRef.current.currentTime + delta / FPS));
          videoRef.current.currentTime = t;
          setCurrentTime(t);
        }
      }
    };
    const onWheel = (e) => {
      const inTimeline = e.target.closest?.('.tl-zoom-wrap') || e.target.closest?.('.tl-overview-wrap');
      if (!inTimeline) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const moveSec = (delta / 300) * 10;
      if (videoRef.current) {
        const t = Math.max(0, Math.min(videoDurationRef.current, videoRef.current.currentTime + moveSec));
        videoRef.current.currentTime = t;
        setCurrentTime(t);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
    };
  }, [togglePlay]);

  // 재생 중 자막 패널 자동 동기화
  useEffect(() => {
    if (!isPlaying) return;
    const activeIdx = subtitles.findIndex(s => currentTime >= s.start && currentTime < s.end);
    if (activeIdx !== -1 && activeIdx !== lastActiveIdx.current) {
      lastActiveIdx.current = activeIdx;
      setFocusedIdx(activeIdx);
      clipRefs.current[activeIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentTime, isPlaying, subtitles]);

  const seekFrames = (delta) => {
    if (!videoRef.current) return;
    const t = Math.max(0, videoRef.current.currentTime + delta/FPS);
    videoRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const adjustFrames = (idx, delta) => {
    const next = [...subtitles];
    const target = { ...next[idx], end: Math.max(next[idx].start + 0.1, next[idx].end + delta/FPS) };
    const diff = target.end - next[idx].end;
    next[idx] = target;
    for (let i = idx+1; i < next.length; i++) next[i] = { ...next[i], start: next[i].start+diff, end: next[i].end+diff };
    setSubtitles(next);
  };

  const handleKeyDown = (e, idx) => {
    if (e.nativeEvent.isComposing) return;
    const { selectionStart, value } = e.target;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const newStart = subtitles[idx].end;
      const next = [...subtitles];
      next.splice(idx+1, 0, { id: `n-${Date.now()}`, start: newStart, end: newStart+DEFAULT_DURATION, text: '' });
      setSubtitles(next);
      setTimeout(() => { textareaRefs.current[idx+1]?.focus(); setFocusedIdx(idx+1); }, 50);
    }
    if (e.key === 'Backspace' && selectionStart === 0 && value === '' && idx > 0) {
      e.preventDefault();
      setSubtitles(subtitles.filter((_,i) => i !== idx));
      setTimeout(() => { textareaRefs.current[idx-1]?.focus(); setFocusedIdx(idx-1); }, 50);
    }
  };

  // 타임라인 드래그
  const DRAG_SENSITIVITY = 0.1;
  const SNAP_THRESHOLD = 0.3;
  const snapToPlayhead = (value, playhead) => Math.abs(value - playhead) < SNAP_THRESHOLD ? playhead : value;

  const onTimelineDragStart = useCallback((e, idx, type) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    dragState.current = { idx, type, startX: clientX, origStart: subtitlesRef.current[idx].start, origEnd: subtitlesRef.current[idx].end };

    const onMove = (ev) => {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect || !videoDurationRef.current) return;
      const rawDx = (cx - dragState.current.startX) / rect.width * videoDurationRef.current;
      const dx = rawDx * DRAG_SENSITIVITY;
      const { idx, type, origStart, origEnd } = dragState.current;
      const ph = videoRef.current?.currentTime ?? 0;
      setSubtitles(prev => {
        const next = [...prev];
        const s = { ...next[idx] };
        const minDur = 2/FPS;
        if (type === 'move') {
          const dur = origEnd - origStart;
          let newStart = Math.max(0, Math.min(videoDurationRef.current - dur, origStart + dx));
          let newEnd = newStart + dur;
          const snappedStart = snapToPlayhead(newStart, ph);
          const snappedEnd = snapToPlayhead(newEnd, ph);
          if (snappedStart !== newStart) { newStart = snappedStart; newEnd = newStart + dur; }
          else if (snappedEnd !== newEnd) { newEnd = snappedEnd; newStart = newEnd - dur; }
          s.start = newStart; s.end = newEnd;
        } else if (type === 'left') {
          s.start = snapToPlayhead(Math.max(0, Math.min(origEnd - minDur, origStart + dx)), ph);
        } else if (type === 'right') {
          s.end = snapToPlayhead(Math.max(origStart + minDur, Math.min(videoDurationRef.current, origEnd + dx)), ph);
        }
        next[idx] = s;
        return next;
      });
    };

    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, []);

  const previewSubtitle = isPlaying
    ? (subtitles.find(s => currentTime >= s.start && currentTime < s.end) ?? null)
    : (focusedIdx !== null && subtitles[focusedIdx] ? subtitles[focusedIdx] : null);

  const formatLastSaved = () => lastSavedTime
    ? lastSavedTime.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' }) : '';

  const closeAll = () => { setIsMenuOpen(false); setIsSaveOpen(false); };

  const addSubAtCurrentTime = () => {
    const newSub = { id: `add-${Date.now()}`, start: currentTime, end: currentTime+DEFAULT_DURATION, text: '' };
    const next = [...subtitles, newSub].sort((a,b) => a.start - b.start);
    const newIdx = next.findIndex(s => s.id === newSub.id);
    setSubtitles(next);
    setTimeout(() => { textareaRefs.current[newIdx]?.focus(); setFocusedIdx(newIdx); }, 50);
  };

  const timelinePx = (sec) => videoDuration ? `${(sec/videoDuration)*100}%` : '0%';

  return (
    <div className="app-root" onClick={closeAll}>
      {toast && <div className="toast">{toast}</div>}

      <header className="app-header" onClick={e => e.stopPropagation()}>
        <div className="app-brand">
          <div className="app-logo">L</div>
          <div className="brand-text">
            <h1 className="project-name">{projectName}</h1>
            <span className={`save-status ${saveStatus}`}>
              {saveStatus==='saved' ? `✅${lastSavedTime ? ` ${formatLastSaved()}` : ''}` : '🔴'}
            </span>
          </div>
        </div>
        <div className="header-actions">
          <div className="dropdown-container">
            <button className="secondary-button" onClick={() => { setIsMenuOpen(!isMenuOpen); setIsSaveOpen(false); }}>📂 메뉴</button>
            {isMenuOpen && (
              <div className="dropdown-menu">
                <input type="file" id="v" hidden onChange={e => { setVideoUrl(URL.createObjectURL(e.target.files[0])); closeAll(); }} />
                <label htmlFor="v" className="menu-item">📹 영상 불러오기</label>
                <input type="file" id="s" hidden accept=".srt" onChange={async e => { setSubtitles(parseSRT(await e.target.files[0].text())); closeAll(); showToast('📜 SRT 불러오기 완료!'); }} />
                <label htmlFor="s" className="menu-item">📜 SRT 불러오기</label>
                <input type="file" id="j" hidden accept=".json" onChange={async e => {
                  const d = JSON.parse(await e.target.files[0].text());
                  setProjectName(d.projectName); setSubtitles(d.subtitles); closeAll();
                  showToast(`📁 "${d.projectName}" 불러오기 완료!`);
                }} />
                <label htmlFor="j" className="menu-item">📁 JSON 불러오기<span className="menu-sub">다른 기기에서 이어서 작업</span></label>
                <button className="menu-item reset" onClick={() => { if(window.confirm('자막을 모두 초기화할까요?')) { setSubtitles([]); closeAll(); } }}>🔄 초기화</button>
              </div>
            )}
          </div>
          <div className="dropdown-container">
            <button className="primary-button" onClick={() => { setIsSaveOpen(!isSaveOpen); setIsMenuOpen(false); }}>💾 저장</button>
            {isSaveOpen && (
              <div className="dropdown-menu">
                <button className="menu-item" onClick={() => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([JSON.stringify({projectName,subtitles})],{type:'application/json'}));
                  a.download = `${projectName}.json`; a.click(); closeAll(); showToast('📁 JSON 저장 완료!');
                }}>📁 JSON으로 저장<span className="menu-sub">다른 기기에서 이어서 쓸 때</span></button>
                <button className="menu-item" onClick={() => {
                  const a = document.createElement('a');
                  const srt = subtitles.map((s,i) => `${i+1}\n${secondsToSrtTime(s.start)} --> ${secondsToSrtTime(s.end)}\n${s.text}`).join('\n\n');
                  a.href = URL.createObjectURL(new Blob([srt],{type:'text/plain'}));
                  a.download = `${projectName}.srt`; a.click(); closeAll(); showToast('📝 SRT 내보내기 완료!');
                }}>📝 SRT 내보내기<span className="menu-sub">다빈치에 바로 가져다 쓸 때</span></button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="video-panel">
          <div className="video-container">
            {videoUrl ? (
              <>
                <video ref={videoRef} src={videoUrl} playsInline
                  onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
                  onLoadedMetadata={e => setVideoDuration(e.target.duration)}
                />
                {previewSubtitle?.text && <div className="subtitle-overlay">{previewSubtitle.text}</div>}
              </>
            ) : (
              <div className="placeholder">영상을 불러와주세요 😊</div>
            )}
          </div>

          {/* 전체 타임라인 (얇은 바) */}
          {videoDuration > 0 && (
            <div className="tl-overview-wrap">
              <div className="tl-overview" onClick={e => {
                if (dragState.current) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const t = Math.max(0, Math.min(videoDuration, (e.clientX - rect.left) / rect.width * videoDuration));
                if (videoRef.current) { videoRef.current.currentTime = t; setCurrentTime(t); }
              }}>
                <div className="tl-overview-progress" style={{ width: timelinePx(currentTime) }} />
                {subtitles.map((s, i) => (
                  <div key={s.id} className={"tl-ov-block" + (i === focusedIdx ? " tl-active" : "")}
                    style={{ left: timelinePx(s.start), width: `calc(${timelinePx(s.end)} - ${timelinePx(s.start)})` }}
                    onClick={e => { e.stopPropagation(); setFocusedIdx(i); if(videoRef.current){ videoRef.current.currentTime=s.start; setCurrentTime(s.start); } }}
                  />
                ))}
                <div className="tl-ov-playhead" style={{ left: timelinePx(currentTime) }} />
              </div>
            </div>
          )}

          {/* 줌인 타임라인 */}
          {videoDuration > 0 && (() => {
            const ZOOM_WINDOW = 20;
            let zStart = currentTime - ZOOM_WINDOW / 2;
            let zEnd = currentTime + ZOOM_WINDOW / 2;
            if (zStart < 0) { zEnd -= zStart; zStart = 0; }
            if (zEnd > videoDuration) { zStart -= (zEnd - videoDuration); zEnd = videoDuration; zStart = Math.max(0, zStart); }
            const toZoomPct = (sec) => `${((sec - zStart) / ZOOM_WINDOW) * 100}%`;
            const visibleSubs = subtitles.filter(s => s.end > zStart && s.start < zEnd);
            const tickStep = 2;
            const firstTick = Math.ceil(zStart / tickStep) * tickStep;
            const ticks = [];
            for (let t = firstTick; t <= zEnd + 0.01; t += tickStep) ticks.push(Math.round(t * 100) / 100);
            return (
              <div className="tl-zoom-wrap">
                <div className="tl-zoom-bar" ref={timelineRef}
                  onClick={e => {
                    if (dragState.current) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const t = zStart + (e.clientX - rect.left) / rect.width * ZOOM_WINDOW;
                    const clamped = Math.max(0, Math.min(videoDuration, t));
                    if (videoRef.current) { videoRef.current.currentTime = clamped; setCurrentTime(clamped); }
                  }}
                >
                  {ticks.map(t => (
                    <div key={t} className="tl-tick" style={{ left: toZoomPct(t) }}>
                      <div className="tl-tick-line" />
                      <span className="tl-tick-label">{secondsToTimecode(t).slice(3,8)}</span>
                    </div>
                  ))}
                  {visibleSubs.map(s => {
                    const i = subtitles.indexOf(s);
                    const isActive = i === focusedIdx || (currentTime >= s.start && currentTime < s.end);
                    const lPct = ((Math.max(s.start, zStart) - zStart) / ZOOM_WINDOW) * 100;
                    const rPct = ((Math.min(s.end, zEnd) - zStart) / ZOOM_WINDOW) * 100;
                    return (
                      <div key={s.id}
                        className={"tl-block" + (isActive ? " tl-active" : "")}
                        style={{ left: `${lPct}%`, width: `${Math.max(0, rPct - lPct)}%` }}
                        onMouseDown={e => onTimelineDragStart(e, i, "move")}
                        onTouchStart={e => onTimelineDragStart(e, i, "move")}
                        onClick={e => { e.stopPropagation(); setFocusedIdx(i); if(videoRef.current){ videoRef.current.currentTime=s.start; setCurrentTime(s.start); } }}
                      >
                        <div className="tl-handle tl-left"
                          onMouseDown={e => { e.stopPropagation(); onTimelineDragStart(e, i, "left"); }}
                          onTouchStart={e => { e.stopPropagation(); onTimelineDragStart(e, i, "left"); }}
                        />
                        <span className="tl-label">{s.text ? s.text.slice(0,12) : "#" + (i+1)}</span>
                        <div className="tl-handle tl-right"
                          onMouseDown={e => { e.stopPropagation(); onTimelineDragStart(e, i, "right"); }}
                          onTouchStart={e => { e.stopPropagation(); onTimelineDragStart(e, i, "right"); }}
                        />
                      </div>
                    );
                  })}
                  <div className="tl-playhead" style={{ left: toZoomPct(currentTime) }} />
                </div>
              </div>
            );
          })()}

          <div className="video-controls">
            <button onClick={() => seekFrames(-5)}>-5F</button>
            <button onClick={() => seekFrames(-1)}>-1F</button>
            <button className="play-btn" onClick={togglePlay}>{isPlaying ? '⏸' : '▶️'}</button>
            <button onClick={() => seekFrames(1)}>+1F</button>
            <button onClick={() => seekFrames(5)}>+5F</button>
          </div>
          <div className="time-display">{secondsToTimecode(currentTime)}</div>
        </section>

        <section className="subtitle-panel" ref={subtitlePanelRef}>
          <div className="panel-tabs">
            <button className={`panel-tab ${panelView==='card' ? 'active' : ''}`} onClick={() => setPanelView('card')}>📋 카드 뷰</button>
            <button className={`panel-tab ${panelView==='script' ? 'active' : ''}`} onClick={() => setPanelView('script')}>📝 스크립트 뷰</button>
            {subtitles.length > 0 && (
              <button className="add-inline-btn" onClick={addSubAtCurrentTime}>＋ 자막 추가</button>
            )}
          </div>

          {subtitles.length === 0 && (
            <button className="add-btn" onClick={() => {
              setSubtitles([{ id:'init', start:currentTime, end:currentTime+DEFAULT_DURATION, text:'' }]);
              setTimeout(() => { textareaRefs.current[0]?.focus(); setFocusedIdx(0); }, 50);
            }}>+ 첫 자막 추가</button>
          )}

          {/* 카드 뷰 */}
          {panelView === 'card' && subtitles.map((s, i) => {
            const dur = s.end - s.start;
            const isTooLong = s.text.length / dur > MAX_CPS;
            const isActive = isPlaying ? (currentTime >= s.start && currentTime < s.end) : i === focusedIdx;
            return (
              <div key={s.id} ref={el => clipRefs.current[i] = el}
                className={`clip ${isActive ? 'active' : ''} ${isTooLong ? 'warning-red' : ''}`}>
                <div className="clip-header">
                  <span>#{i+1} {secondsToTimecode(s.start)} → {secondsToTimecode(s.end)}</span>
                  <div className="clip-btns">
                    <button onClick={() => adjustFrames(i, -10)}>-10F</button>
                    <button onClick={() => adjustFrames(i, 10)}>+10F</button>
                    <button onClick={() => setSubtitles(subtitles.filter(x => x.id !== s.id))}>×</button>
                  </div>
                </div>
                <textarea
                  ref={el => textareaRefs.current[i] = el}
                  value={s.text}
                  onChange={e => setSubtitles(subtitles.map(x => x.id===s.id ? {...x,text:e.target.value} : x))}
                  onKeyDown={e => handleKeyDown(e, i)}
                  onFocus={() => {
                    setFocusedIdx(i);
                    if (videoRef.current) { videoRef.current.currentTime = s.start; setCurrentTime(s.start); }
                  }}
                  placeholder="자막 입력..."
                />
              </div>
            );
          })}

          {/* 스크립트 뷰 */}
          {panelView === 'script' && (
            <div className="script-view">
              {subtitles.map((s, i) => {
                const isActive = isPlaying ? (currentTime >= s.start && currentTime < s.end) : i === focusedIdx;
                return (
                  <div key={s.id} ref={el => clipRefs.current[i] = el}
                    className={`script-line ${isActive ? 'active' : ''}`}>
                    <span className="script-tc" onClick={() => {
                      setFocusedIdx(i);
                      if (videoRef.current) { videoRef.current.currentTime = s.start; setCurrentTime(s.start); }
                    }}>{secondsToTimecode(s.start)}</span>
                    <textarea
                      ref={el => textareaRefs.current[i] = el}
                      className="script-textarea"
                      value={s.text}
                      onChange={e => setSubtitles(subtitles.map(x => x.id===s.id ? {...x,text:e.target.value} : x))}
                      onKeyDown={e => handleKeyDown(e, i)}
                      onFocus={() => {
                        setFocusedIdx(i);
                        if (videoRef.current) { videoRef.current.currentTime = s.start; setCurrentTime(s.start); }
                      }}
                      placeholder="자막 입력..."
                      rows={1}
                    />
                    <button className="script-del-btn"
                      onClick={() => setSubtitles(subtitles.filter(x => x.id !== s.id))}>×</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}