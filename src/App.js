import React, { useState, useRef, useEffect } from 'react';
import './App.css';

const DEFAULT_DURATION = 2.5; 
const FPS = 24;
const STORAGE_KEY = 'subtitleEditor_subtitles_v1';

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

  const videoRef = useRef(null);
  const textareaRefs = useRef([]);

  // ✨ 핵심 추가: 키보드가 올라올 때 화면 높이를 실시간으로 계산하는 레이더
  useEffect(() => {
    const handleViewportChange = () => {
      if (window.visualViewport) {
        // 현재 실제로 보이는 화면 높이를 계산해서 CSS 변수(--vh)로 넘겨줌
        document.documentElement.style.setProperty('--vh', `${window.visualViewport.height}px`);
        // 브라우저가 멋대로 스크롤 올리는 걸 강제로 0으로 끌어내림!
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportChange);
      window.visualViewport.addEventListener('scroll', handleViewportChange);
      handleViewportChange(); // 처음 켰을 때 초기 세팅
    }

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportChange);
        window.visualViewport.removeEventListener('scroll', handleViewportChange);
      }
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) setSubtitles(JSON.parse(raw));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(subtitles));
  }, [subtitles]);

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
      setTimeout(() => {
        if (videoRef.current) videoRef.current.currentTime = mid;
        if (textareaRefs.current[idx + 1]) {
          textareaRefs.current[idx + 1].focus();
        }
      }, 50);
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

  const adjustFrames = (idx, delta) => {
    const next = [...subtitles];
    const target = { ...next[idx], end: Math.max(next[idx].start + 0.1, next[idx].end + (delta / FPS)) };
    const diff = target.end - next[idx].end;
    next[idx] = target;
    for (let i = idx + 1; i < next.length; i++) {
      next[i] = { ...next[i], start: next[i].start + diff, end: next[i].end + diff };
    }
    setSubtitles(next);
    if (videoRef.current) videoRef.current.currentTime = target.end;
  };

  return (
    <div className="app-root" onClick={() => { setIsMenuOpen(false); setIsSaveOpen(false); }}>
      <header className="app-header" onClick={(e) => e.stopPropagation()}>
        <div className="app-brand">
          <div className="app-logo">L</div>
          <div><h1 className="project-name">{projectName}</h1></div>
        </div>
        <div className="header-actions">
          <div className="dropdown-container">
            <button className={`secondary-button ${isMenuOpen ? 'active' : ''}`} onClick={() => {setIsMenuOpen(!isMenuOpen); setIsSaveOpen(false);}}>📂 메뉴</button>
            {isMenuOpen && (
              <div className="dropdown-menu">
                <input type="file" id="v" hidden onChange={e => { setVideoUrl(URL.createObjectURL(e.target.files[0])); setIsMenuOpen(false); }} />
                <label htmlFor="v" className="menu-item">📹 영상 불러오기</label>
                <input type="file" id="s" hidden accept=".srt" onChange={async e => { setSubtitles(parseSRT(await e.target.files[0].text())); setIsMenuOpen(false); }} />
                <label htmlFor="s" className="menu-item">📜 SRT 불러오기</label>
                <input type="file" id="j" hidden accept=".json" onChange={async e => {
                  const data = JSON.parse(await e.target.files[0].text());
                  setProjectName(data.projectName); setSubtitles(data.subtitles); setIsMenuOpen(false);
                }} />
                <label htmlFor="j" className="menu-item">📁 JSON 불러오기</label>
                <button className="menu-item reset" onClick={() => { setSubtitles([]); setIsMenuOpen(false); }}>🔄 초기화</button>
              </div>
            )}
          </div>

          <div className="dropdown-container">
            <button className={`primary-button ${isSaveOpen ? 'active' : ''}`} onClick={() => {setIsSaveOpen(!isSaveOpen); setIsMenuOpen(false);}}>💾 저장</button>
            {isSaveOpen && (
              <div className="dropdown-menu">
                <button className="menu-item" onClick={() => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([JSON.stringify({ projectName, subtitles })], { type: 'application/json' }));
                  a.download = `${projectName}.json`; a.click(); setIsSaveOpen(false);
                }}>📁 JSON 저장하기</button>
                <button className="menu-item" onClick={() => {
                  const a = document.createElement('a');
                  const srtText = subtitles.map((s, i) => `${i+1}\n${secondsToSrtTime(s.start)} --> ${secondsToSrtTime(s.end)}\n${s.text}`).join('\n\n');
                  a.href = URL.createObjectURL(new Blob([srtText], { type: 'text/plain' }));
                  a.download = `${projectName}.srt`; a.click(); setIsSaveOpen(false);
                }}>📝 SRT 내보내기</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="sticky-video-panel">
          <div className="video-container">
            {videoUrl ? (
              <video ref={videoRef} src={videoUrl} playsInline webkit-playsinline="true" onTimeUpdate={e => setCurrentTime(e.target.currentTime)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
            ) : (
              <div className="placeholder">영상을 불러와주세요 😊</div>
            )}
          </div>
          <div className="video-controls">
            <div className="seek-group">
              <button className="seek-btn" onClick={() => seekFrames(-5)}>-5F</button>
              <button className="seek-btn" onClick={() => seekFrames(-1)}>-1F</button>
            </div>
            <button className="play-btn" onClick={togglePlay}>{isPlaying ? '⏸ 일시정지' : '▶️ 재생'}</button>
            <div className="seek-group">
              <button className="seek-btn" onClick={() => seekFrames(1)}>+1F</button>
              <button className="seek-btn" onClick={() => seekFrames(5)}>+5F</button>
            </div>
          </div>
          <div className="time-display">현재 시간: <strong>{secondsToTimecode(currentTime)}</strong></div>
        </section>

        <section className="subtitle-scroll-panel">
          {subtitles.length === 0 && (
            <div className="empty-state">
              <button className="primary-button add-first-btn" onClick={() => setSubtitles([{ id: 'init', start: currentTime, end: currentTime + 2.5, text: '' }])}>+ 첫 자막 추가하기</button>
            </div>
          )}
          {subtitles.map((s, i) => (
            <div key={s.id} className={`clip-block ${currentTime >= s.start && currentTime <= s.end ? 'active' : ''}`} onClick={() => videoRef.current && (videoRef.current.currentTime = s.start)}>
              <div className="clip-meta">
                <span className="idx">#{i+1}</span>
                <span className="time">{secondsToTimecode(s.start)} - {secondsToTimecode(s.end)}</span>
                <div className="frame-btns">
                  <button onClick={e => { e.stopPropagation(); adjustFrames(i, -10); }}>-10F</button>
                  <button onClick={e => { e.stopPropagation(); adjustFrames(i, 10); }}>+10F</button>
                  <button className="del-btn" onClick={e => { e.stopPropagation(); setSubtitles(subtitles.filter(x => x.id !== s.id)); }}>×</button>
                </div>
              </div>
              <textarea 
                ref={el => textareaRefs.current[i] = el}
                className="clip-text" 
                value={s.text} 
                onKeyDown={e => handleKeyDown(e, i)} 
                onChange={e => setSubtitles(subtitles.map(x => x.id === s.id ? {...x, text: e.target.value} : x))} 
                placeholder="자막 내용을 입력하세요..." 
                /* ✨ 포커스될 때 브라우저가 위로 튕기는 기본 동작을 한번 더 막아주는 역할 */
                onFocus={() => {
                  window.scrollTo(0, 0);
                  if (videoRef.current) videoRef.current.currentTime = s.start;
                }}
              />
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

export default App;