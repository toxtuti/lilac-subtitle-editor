import React, { useState, useRef, useEffect } from 'react';
import './App.css';

const DEFAULT_DURATION = 3;
const FPS = 24;
const STORAGE_KEY = 'subtitleEditor_subtitles_v1';
const MAX_CPS = 25;

function secondsToTimecode(totalSeconds) {
  if (Number.isNaN(totalSeconds) || totalSeconds == null) return '00:00:00:00';
  const totalFrames = Math.max(0, Math.round(totalSeconds * FPS));
  const hours = Math.floor(totalFrames / (3600 * FPS));
  const minutes = Math.floor((totalFrames % (3600 * FPS)) / (60 * FPS));
  const seconds = Math.floor((totalFrames % (60 * FPS)) / FPS);
  const frames = totalFrames % FPS;
  const pad = (n, width) => String(n).padStart(width, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}:${pad(frames, 2)}`;
}

function secondsToSrtTime(totalSeconds) {
  const clamped = Math.max(0, totalSeconds || 0);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n, width) => String(n).padStart(width, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(ms, 3)}`;
}

function parseSRT(text) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).filter(Boolean);
  return blocks.map((block, idx) => {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines.find(l => l.includes('-->')) || '';
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    const srtToSec = (str) => {
      const [hms, ms = '0'] = str.split(',');
      const [h, m, s] = hms.split(':').map(Number);
      return h * 3600 + m * 60 + s + Number(ms) / 1000;
    };
    return {
      id: `srt-${idx}-${Date.now()}`,
      start: startStr ? srtToSec(startStr) : 0,
      end: endStr ? srtToSec(endStr) : DEFAULT_DURATION,
      text: lines.slice(lines.indexOf(timeLine) + 1).join('\n')
    };
  }).sort((a, b) => a.start - b.start);
}

function App() {
  const [videoUrl, setVideoUrl] = useState(null);
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

  const isFirstLoad = useRef(true);
  const videoRef = useRef(null);
  const textareaRefs = useRef([]);
  const clipRefs = useRef([]);
  const subtitlePanelRef = useRef(null);
  const lastActiveIdx = useRef(-1);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const vvp = window.visualViewport;
    if (!vvp) return;
    const onViewportChange = () => {
      document.documentElement.style.setProperty('--app-height', `${vvp.height}px`);
      document.documentElement.style.setProperty('--app-top', `${vvp.offsetTop}px`);
      window.scrollTo(0, 0);
    };
    vvp.addEventListener('resize', onViewportChange);
    vvp.addEventListener('scroll', onViewportChange);
    onViewportChange();
    return () => {
      vvp.removeEventListener('resize', onViewportChange);
      vvp.removeEventListener('scroll', onViewportChange);
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) setSubtitles(JSON.parse(raw));
  }, []);

  useEffect(() => {
    if (isFirstLoad.current) { isFirstLoad.current = false; return; }
    setSaveStatus('unsaved');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subtitles));
    const timer = setTimeout(() => {
      setSaveStatus('saved');
      setLastSavedTime(new Date());
    }, 800);
    return () => clearTimeout(timer);
  }, [subtitles]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (subtitles.length > 0) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [subtitles.length]);

  // ✅ 재생 중 currentTime 기준으로 자막 패널 자동 동기화
  useEffect(() => {
    if (!isPlaying) return;
    const activeIdx = subtitles.findIndex(s => currentTime >= s.start && currentTime <= s.end);
    if (activeIdx !== -1 && activeIdx !== lastActiveIdx.current) {
      lastActiveIdx.current = activeIdx;
      setFocusedIdx(activeIdx);
      // 자막 패널 자동 스크롤
      clipRefs.current[activeIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentTime, isPlaying, subtitles]);

  // ✅ 재생: 포커스된 자막 시작점부터 재생
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      // 포커스된 자막이 있으면 그 시작점부터, 없으면 현재 위치에서
      if (focusedIdx !== null && subtitles[focusedIdx]) {
        const startTime = subtitles[focusedIdx].start;
        videoRef.current.currentTime = startTime;
        setCurrentTime(startTime);
      }
      lastActiveIdx.current = -1; // 리셋해서 재생 시작 시 즉시 포커스 이동
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const seekFrames = (delta) => {
    if (videoRef.current) {
      const newTime = Math.max(0, videoRef.current.currentTime + (delta / FPS));
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const adjustFrames = (idx, delta) => {
    const next = [...subtitles];
    const target = { ...next[idx], end: Math.max(next[idx].start + 0.1, next[idx].end + (delta / FPS)) };
    const diff = target.end - next[idx].end;
    next[idx] = target;
    for (let i = idx + 1; i < next.length; i++) {
      next[i] = { ...next[i], start: next[i].start + diff, end: next[i].end + diff };
    }
    setSubtitles(next);
  };

  const handleKeyDown = (e, idx) => {
    if (e.nativeEvent.isComposing) return;
    const { selectionStart, value } = e.target;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const target = subtitles[idx];
      const newStart = target.end;
      const newEnd = newStart + DEFAULT_DURATION;
      const next = [...subtitles];
      next.splice(idx + 1, 0, { id: `n-${Date.now()}`, start: newStart, end: newEnd, text: '' });
      setSubtitles(next);
      setTimeout(() => {
        textareaRefs.current[idx + 1]?.focus();
        setFocusedIdx(idx + 1);
      }, 50);
    }
    if (e.key === 'Backspace' && selectionStart === 0 && value === '' && idx > 0) {
      e.preventDefault();
      const next = subtitles.filter((_, i) => i !== idx);
      setSubtitles(next);
      setTimeout(() => {
        textareaRefs.current[idx - 1]?.focus();
        setFocusedIdx(idx - 1);
      }, 50);
    }
  };

  // ✅ 미리보기: 재생 중이면 currentTime 기준, 정지 중이면 focusedIdx 기준
  const previewSubtitle = isPlaying
    ? subtitles.find(s => currentTime >= s.start && currentTime <= s.end) ?? null
    : (focusedIdx !== null ? subtitles[focusedIdx] : null);

  const formatLastSaved = () => {
    if (!lastSavedTime) return '';
    return lastSavedTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  const closeAll = () => { setIsMenuOpen(false); setIsSaveOpen(false); };

  return (
    <div className="app-root" onClick={closeAll}>
      {toast && <div className="toast">{toast}</div>}

      <header className="app-header" onClick={(e) => e.stopPropagation()}>
        <div className="app-brand">
          <div className="app-logo">L</div>
          <div className="brand-text">
            <h1 className="project-name">{projectName}</h1>
            <span className={`save-status ${saveStatus}`}>
              {saveStatus === 'saved' ? `✅${lastSavedTime ? ` ${formatLastSaved()}` : ''}` : '🔴'}
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
                  const data = JSON.parse(await e.target.files[0].text());
                  setProjectName(data.projectName); setSubtitles(data.subtitles); closeAll();
                  showToast(`📁 "${data.projectName}" 불러오기 완료!`);
                }} />
                <label htmlFor="j" className="menu-item">📁 JSON 불러오기<span className="menu-sub">다른 기기에서 이어서 작업</span></label>
                <button className="menu-item reset" onClick={() => { if (window.confirm('자막을 모두 초기화할까요?')) { setSubtitles([]); closeAll(); } }}>🔄 초기화</button>
              </div>
            )}
          </div>
          <div className="dropdown-container">
            <button className="primary-button" onClick={() => { setIsSaveOpen(!isSaveOpen); setIsMenuOpen(false); }}>💾 저장</button>
            {isSaveOpen && (
              <div className="dropdown-menu">
                <button className="menu-item" onClick={() => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([JSON.stringify({ projectName, subtitles })], { type: 'application/json' }));
                  a.download = `${projectName}.json`; a.click(); closeAll(); showToast('📁 JSON 저장 완료!');
                }}>📁 JSON으로 저장<span className="menu-sub">다른 기기에서 이어서 쓸 때</span></button>
                <button className="menu-item" onClick={() => {
                  const a = document.createElement('a');
                  const srt = subtitles.map((s, i) => `${i + 1}\n${secondsToSrtTime(s.start)} --> ${secondsToSrtTime(s.end)}\n${s.text}`).join('\n\n');
                  a.href = URL.createObjectURL(new Blob([srt], { type: 'text/plain' }));
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
                <video ref={videoRef} src={videoUrl} playsInline onTimeUpdate={e => setCurrentTime(e.target.currentTime)} />
                {previewSubtitle?.text && (
                  <div className="subtitle-overlay">{previewSubtitle.text}</div>
                )}
              </>
            ) : (
              <div className="placeholder">영상을 불러와주세요 😊</div>
            )}
          </div>
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
          {subtitles.length === 0 && (
            <button className="add-btn" onClick={() => {
              setSubtitles([{ id: 'init', start: currentTime, end: currentTime + DEFAULT_DURATION, text: '' }]);
              setTimeout(() => { textareaRefs.current[0]?.focus(); setFocusedIdx(0); }, 50);
            }}>+ 첫 자막 추가</button>
          )}
          {subtitles.map((s, i) => {
            const duration = s.end - s.start;
            const isTooLong = s.text.length / duration > MAX_CPS;
            const isActive = isPlaying
              ? (currentTime >= s.start && currentTime <= s.end)
              : i === focusedIdx;
            return (
              <div
                key={s.id}
                ref={el => clipRefs.current[i] = el}
                className={`clip ${isActive ? 'active' : ''} ${isTooLong ? 'warning-red' : ''}`}
              >
                <div className="clip-header">
                  <span>#{i + 1} {secondsToTimecode(s.start)} → {secondsToTimecode(s.end)}</span>
                  <div className="clip-btns">
                    <button onClick={() => adjustFrames(i, -10)}>-10F</button>
                    <button onClick={() => adjustFrames(i, 10)}>+10F</button>
                    <button onClick={() => setSubtitles(subtitles.filter(x => x.id !== s.id))}>×</button>
                  </div>
                </div>
                <textarea
                  ref={el => textareaRefs.current[i] = el}
                  value={s.text}
                  onChange={e => setSubtitles(subtitles.map(x => x.id === s.id ? { ...x, text: e.target.value } : x))}
                  onKeyDown={e => handleKeyDown(e, i)}
                  onFocus={() => {
                    setFocusedIdx(i);
                    if (videoRef.current) {
                      videoRef.current.currentTime = s.start;
                      setCurrentTime(s.start);
                    }
                  }}
                  placeholder="자막 입력..."
                />
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}

export default App;