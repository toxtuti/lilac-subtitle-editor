import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

const DEFAULT_DURATION = 2.5;
const FPS = 24;
const STORAGE_KEY = 'subtitleEditor_subtitles_v1';
const MAX_CPS = 15;

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

// 드롭다운 위치를 버튼 기준으로 동적 계산
function Dropdown({ triggerRef, isOpen, children }) {
  const [style, setStyle] = useState({});

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setStyle({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen, triggerRef]);

  if (!isOpen) return null;
  return (
    <div className="dropdown-menu" style={style}>
      {children}
    </div>
  );
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

  const isFirstLoad = useRef(true);
  const videoRef = useRef(null);
  const textareaRefs = useRef([]);
  const menuBtnRef = useRef(null);
  const saveBtnRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // ✨ 키보드 밀림 방지
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

  // 초기 로드
  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) setSubtitles(JSON.parse(raw));
  }, []);

  // 자막 변경 시 브라우저에 자동저장 + 상태 표시
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    setSaveStatus('unsaved');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subtitles));
    const timer = setTimeout(() => {
      setSaveStatus('saved');
      setLastSavedTime(new Date());
    }, 800);
    return () => clearTimeout(timer);
  }, [subtitles]);

  // 탭 닫기 경고
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (subtitles.length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [subtitles.length]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
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
      const mid = target.start + (target.end - target.start) / 2;
      const next = [...subtitles];
      next.splice(idx, 1,
        { ...target, end: mid, text: value.substring(0, selectionStart).trim() },
        { id: `n-${Date.now()}`, start: mid, end: target.end, text: value.substring(selectionStart).trim() }
      );
      setSubtitles(next);
      setTimeout(() => textareaRefs.current[idx + 1]?.focus(), 50);
    }
    if (e.key === 'Backspace' && selectionStart === 0 && idx > 0) {
      e.preventDefault();
      const prev = subtitles[idx - 1];
      const curr = subtitles[idx];
      const next = [...subtitles];
      next.splice(idx - 1, 2, { ...prev, end: curr.end, text: (prev.text + ' ' + curr.text).trim() });
      setSubtitles(next);
      setTimeout(() => textareaRefs.current[idx - 1]?.focus(), 50);
    }
  };

  const activeSubtitle = subtitles.find(s => currentTime >= s.start && currentTime <= s.end);

  const formatLastSaved = () => {
    if (!lastSavedTime) return '';
    return lastSavedTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="app-root" onClick={() => { setIsMenuOpen(false); setIsSaveOpen(false); }}>

      {toast && <div className="toast">{toast}</div>}

      <header className="app-header" onClick={(e) => e.stopPropagation()}>
        <div className="app-brand">
          <div className="app-logo">L</div>
          <div className="brand-text">
            <h1 className="project-name">{projectName}</h1>
            <span className={`save-status ${saveStatus}`}>
              {saveStatus === 'saved'
                ? `✅ 저장됨${lastSavedTime ? ` ${formatLastSaved()}` : ''}`
                : '🔴 저장 중...'}
            </span>
          </div>
        </div>

        <div className="header-actions">
          <div className="dropdown-container">
            <button
              ref={menuBtnRef}
              className="secondary-button"
              onClick={() => { setIsMenuOpen(!isMenuOpen); setIsSaveOpen(false); }}
            >
              📂 메뉴
            </button>
            <Dropdown triggerRef={menuBtnRef} isOpen={isMenuOpen}>
              <input type="file" id="v" hidden onChange={e => {
                setVideoUrl(URL.createObjectURL(e.target.files[0]));
                setIsMenuOpen(false);
              }} />
              <label htmlFor="v" className="menu-item">📹 영상 불러오기</label>

              <input type="file" id="s" hidden accept=".srt" onChange={async e => {
                setSubtitles(parseSRT(await e.target.files[0].text()));
                setIsMenuOpen(false);
                showToast('📜 SRT 불러오기 완료!');
              }} />
              <label htmlFor="s" className="menu-item">📜 SRT 불러오기</label>

              <input type="file" id="j" hidden accept=".json" onChange={async e => {
                const data = JSON.parse(await e.target.files[0].text());
                setProjectName(data.projectName);
                setSubtitles(data.subtitles);
                setIsMenuOpen(false);
                showToast(`📁 "${data.projectName}" 불러오기 완료!`);
              }} />
              <label htmlFor="j" className="menu-item">
                📁 JSON 불러오기
                <span className="menu-sub">다른 기기에서 이어서 작업</span>
              </label>

              <button className="menu-item reset" onClick={() => {
                if (window.confirm('자막을 모두 초기화할까요?')) {
                  setSubtitles([]);
                  setIsMenuOpen(false);
                }
              }}>🔄 초기화</button>
            </Dropdown>
          </div>

          <div className="dropdown-container">
            <button
              ref={saveBtnRef}
              className="primary-button"
              onClick={() => { setIsSaveOpen(!isSaveOpen); setIsMenuOpen(false); }}
            >
              💾 저장
            </button>
            <Dropdown triggerRef={saveBtnRef} isOpen={isSaveOpen}>
              <button className="menu-item" onClick={() => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([JSON.stringify({ projectName, subtitles })], { type: 'application/json' }));
                a.download = `${projectName}.json`;
                a.click();
                setIsSaveOpen(false);
                showToast('📁 JSON 저장 완료!');
              }}>
                📁 JSON으로 저장
                <span className="menu-sub">다른 기기에서 이어서 쓸 때</span>
              </button>
              <button className="menu-item" onClick={() => {
                const a = document.createElement('a');
                const srt = subtitles.map((s, i) => `${i + 1}\n${secondsToSrtTime(s.start)} --> ${secondsToSrtTime(s.end)}\n${s.text}`).join('\n\n');
                a.href = URL.createObjectURL(new Blob([srt], { type: 'text/plain' }));
                a.download = `${projectName}.srt`;
                a.click();
                setIsSaveOpen(false);
                showToast('📝 SRT 내보내기 완료!');
              }}>
                📝 SRT 내보내기
                <span className="menu-sub">다빈치에 바로 가져다 쓸 때</span>
              </button>
            </Dropdown>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="video-panel">
          <div className="video-container">
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
                />
                {activeSubtitle?.text && (
                  <div className="subtitle-overlay">{activeSubtitle.text}</div>
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

        <section className="subtitle-panel">
          {subtitles.length === 0 && (
            <button className="add-btn" onClick={() => setSubtitles([{ id: 'init', start: currentTime, end: currentTime + 2.5, text: '' }])}>
              + 첫 자막 추가
            </button>
          )}
          {subtitles.map((s, i) => {
            const duration = s.end - s.start;
            const isTooLong = s.text.length / duration > MAX_CPS;
            return (
              <div key={s.id} className={`clip ${currentTime >= s.start && currentTime <= s.end ? 'active' : ''} ${isTooLong ? 'warning-red' : ''}`}>
                <div className="clip-header">
                  <span>#{i + 1} {secondsToTimecode(s.start)}</span>
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
                  onFocus={() => videoRef.current && (videoRef.current.currentTime = s.start)}
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