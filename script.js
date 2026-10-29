
const audio = document.getElementById("audio");
const fileInput = document.getElementById("fileInput");

const playBtn = document.getElementById("playBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const favoriteBtn = document.getElementById("favoriteBtn");

const seekBar = document.getElementById("seekBar");
const volumeBar = document.getElementById("volumeBar");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");

const songTitle = document.getElementById("songTitle");
const songArtist = document.getElementById("songArtist");
const songCount = document.getElementById("songCount");
const songList = document.getElementById("songList");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const statusEl = document.getElementById("status");

let songs = [];
let currentIndex = -1;
let favorites = new Set();
let shuffle = false;
let repeatMode = "off";
let isSeeking = false;
let playRequest = 0;
let db;
let sleepDeadline = 0;
let sleepInterval = null;

const DB_NAME = "nova-music-library";
const DB_VERSION = 1;
const STORE_NAME = "songs";

function openLibraryDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveSongRecord(song) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
      id: song.id, title: song.title, artist: song.artist,
      fileName: song.fileName || song.file?.name || song.title,
      fileLastModified: song.fileLastModified || song.file?.lastModified || 0,
      duration: song.duration || 0, blob: song.file,
      embeddedArtwork: song.embeddedArtwork || null,
      customArtwork: song.customArtwork || null,
      favorite: favorites.has(song.id)
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function deleteSongRecord(id) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function persistLibrary() {
  if (!db) throw new Error("Music library database is not ready");
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    songs.forEach(song => store.put({
      id: song.id, title: song.title, artist: song.artist,
      fileName: song.fileName || song.file?.name || song.title,
      fileLastModified: song.fileLastModified || song.file?.lastModified || 0,
      duration: song.duration || 0, blob: song.file,
      embeddedArtwork: song.embeddedArtwork || null,
      customArtwork: song.customArtwork || null,
      favorite: favorites.has(song.id)
    }));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    setStatus("Could not save library. Check browser storage permissions.");
    throw error;
  }
}

function getRecentPlayedIds() {
  try {
    const value = JSON.parse(localStorage.getItem("quantum-recently-played-v110") || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) { return []; }
}

function rememberRecentlyPlayed(song) {
  if (!song) return;
  const ids = [song.id, ...getRecentPlayedIds().filter(id => id !== song.id)].slice(0, 12);
  try { localStorage.setItem("quantum-recently-played-v110", JSON.stringify(ids)); } catch (_) {}
}

function makeHomeTrackRow(song, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "home-track-row";
  row.setAttribute("aria-label", `Play ${song.title}`);
  const thumb = document.createElement("span");
  thumb.className = "home-track-thumb";
  const artwork = song.customArtworkUrl || song.embeddedArtworkUrl;
  if (artwork) {
    const img = document.createElement("img");
    img.src = artwork; img.alt = ""; thumb.appendChild(img);
  } else { thumb.textContent = "♫"; }
  const meta = document.createElement("span"); meta.className = "home-track-meta";
  const title = document.createElement("strong"); title.textContent = song.title;
  const artist = document.createElement("small"); artist.textContent = song.artist || "Local audio";
  meta.append(title, artist);
  const play = document.createElement("span"); play.className = "home-track-play";
  play.textContent = index === currentIndex && !audio.paused ? "Ⅱ" : "▶";
  row.append(thumb, meta, play);
  row.addEventListener("click", () => { loadSong(index, true); showPage("playingView"); });
  return row;
}

function renderHomeDashboard() {
  const welcome = document.getElementById("homeWelcomeEmpty");
  const dashboard = document.getElementById("homeDashboard");
  if (!welcome || !dashboard) return;
  const hasSongs = songs.length > 0;
  welcome.hidden = hasSongs;
  dashboard.hidden = !hasSongs;
  if (!hasSongs) return;

  const current = currentIndex >= 0 ? songs[currentIndex] : null;
  const recentIds = getRecentPlayedIds();
  const recentSongs = recentIds.map(id => ({ song: songs.find(item => item.id === id), id }))
    .filter(entry => entry.song).map(entry => entry.song).slice(0, 4);
  const featureSong = current || recentSongs[0] || songs[songs.length - 1];
  document.getElementById("homeFeatureTitle").textContent = featureSong ? featureSong.title : "Your soundtrack awaits";
  document.getElementById("homeFeatureArtist").textContent = featureSong ? (featureSong.artist || "Local audio") : "Choose a track from your library.";

  const recentList = document.getElementById("homeRecentList");
  recentList.replaceChildren();
  if (!recentSongs.length) {
    const empty = document.createElement("div"); empty.className = "home-inline-empty";
    empty.textContent = "Your recently played tracks will appear here after you listen to music.";
    recentList.appendChild(empty);
  } else {
    recentSongs.forEach(song => recentList.appendChild(makeHomeTrackRow(song, songs.findIndex(item => item.id === song.id))));
  }

  const addedList = document.getElementById("homeAddedList");
  addedList.replaceChildren();
  songs.slice(-4).reverse().forEach(song => addedList.appendChild(makeHomeTrackRow(song, songs.findIndex(item => item.id === song.id))));
  document.getElementById("homeStatSongs").textContent = String(songs.length);
  document.getElementById("homeStatFavorites").textContent = String(favorites.size);
  document.getElementById("homeStatPlaylists").textContent = String(Array.isArray(playlists) ? playlists.length : 0);
}

async function restoreLibrary() {
  try {
    db = await openLibraryDB();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const restoredIds = new Set(songs.map(song => song.id));
    records.forEach(record => {
      if (!record.blob || restoredIds.has(record.id)) return;
      songs.push({
        id: record.id, file: record.blob, fileName: record.fileName || record.blob.name || record.title,
        fileLastModified: record.fileLastModified || record.blob.lastModified || 0,
        url: URL.createObjectURL(record.blob),
        title: record.title, artist: record.artist || "Local audio",
        duration: record.duration || 0,
        embeddedArtwork: record.embeddedArtwork || null,
        customArtwork: record.customArtwork || null,
        embeddedArtworkUrl: record.embeddedArtwork ? URL.createObjectURL(record.embeddedArtwork) : "",
        customArtworkUrl: record.customArtwork ? URL.createObjectURL(record.customArtwork) : ""
      });
      restoredIds.add(record.id);
      if (record.favorite) favorites.add(record.id);
    });
    renderPlaylist();
    if (songs.length) {
      setStatus("Library restored • " + songs.length + " saved song(s)");
    } else {
      setStatus("Add music to build your saved library");
    }
  } catch (error) {
    setStatus("Saved library is unavailable in this browser.");
  }
}

function startSleepTimer(minutes) {
  clearInterval(sleepInterval);
  sleepInterval = null;
  sleepDeadline = 0;
  const countdown = document.getElementById("sleepCountdown");
  if (!countdown) return;
  if (!minutes) {
    countdown.textContent = "Timer off";
    setStatus("Sleep timer turned off");
    return;
  }
  sleepDeadline = Date.now() + minutes * 60 * 1000;
  const tick = () => {
    const remaining = Math.max(0, sleepDeadline - Date.now());
    if (!remaining) {
      audio.pause();
      clearInterval(sleepInterval);
      sleepInterval = null;
      sleepDeadline = 0;
      document.getElementById("sleepSelect").value = "0";
      countdown.textContent = "Timer finished";
      setStatus("Sleep timer finished • playback paused");
      updatePlayButton();
      return;
    }
    const totalSeconds = Math.ceil(remaining / 1000);
    countdown.textContent = "Stops in " + Math.floor(totalSeconds / 60) +
      ":" + String(totalSeconds % 60).padStart(2, "0");
  };
  tick();
  sleepInterval = setInterval(tick, 1000);
  setStatus("Sleep timer set for " + minutes + " minutes");
}

document.getElementById("sleepSelect").addEventListener("change", event => {
  startSleepTimer(Number(event.target.value));
});


// Format seconds as minutes:seconds.
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function setStatus(message) {
  statusEl.textContent = message;
}

// Add music files selected from the phone.
function openFilePicker() {
  fileInput.click();
}

document.getElementById("addBtn").addEventListener(
  "click", openFilePicker
);

document.getElementById("addTop").addEventListener(
  "click", openFilePicker
);

document.getElementById("emptyAddBtn").addEventListener(
  "click", openFilePicker
);

// Read common ID3v2 APIC artwork embedded in MP3 files without uploading the file.
async function extractEmbeddedArtwork(file) {
  try {
    if (!/\.mp3$/i.test(file.name) || file.size < 16) return null;
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer());
    if (String.fromCharCode(...head.slice(0, 3)) !== "ID3") return null;
    const version = head[3];
    if (version < 3 || version > 4) return null;
    const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    let offset = 10, end = Math.min(head.length, 10 + size);
    while (offset + 10 < end) {
      const id = String.fromCharCode(...head.slice(offset, offset + 4));
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      let frameSize = version === 4
        ? ((head[offset+4]&0x7f)<<21)|((head[offset+5]&0x7f)<<14)|((head[offset+6]&0x7f)<<7)|(head[offset+7]&0x7f)
        : (head[offset+4]*16777216)+(head[offset+5]<<16)+(head[offset+6]<<8)+head[offset+7];
      if (!frameSize || offset + 10 + frameSize > end) break;
      if (id === "APIC") {
        const frame = head.slice(offset + 10, offset + 10 + frameSize);
        let pos = 1;
        while (pos < frame.length && frame[pos] !== 0) pos++;
        const mime = new TextDecoder().decode(frame.slice(1, pos)) || "image/jpeg";
        pos += 2; // MIME terminator and picture type
        const encoding = frame[0];
        if (encoding === 0 || encoding === 3) { while (pos < frame.length && frame[pos] !== 0) pos++; pos++; }
        else { while (pos + 1 < frame.length && !(frame[pos] === 0 && frame[pos+1] === 0)) pos += 2; pos += 2; }
        if (pos < frame.length) return new Blob([frame.slice(pos)], { type: mime });
      }
      offset += 10 + frameSize;
    }
  } catch (_) {}
  return null;
}

function renderArtwork(song) {
  const img = document.getElementById("coverImage");
  const cover = document.getElementById("cover");
  if (!img || !cover) return;
  const artworkUrl = song && (song.customArtworkUrl || song.embeddedArtworkUrl);
  if (artworkUrl) {
    img.src = artworkUrl;
    img.hidden = false;
    cover.classList.add("has-artwork");
  } else {
    img.removeAttribute("src"); img.hidden = true;
    cover.classList.remove("has-artwork");
  }
}

fileInput.addEventListener("change", async (event) => {
  // Wait until IndexedDB restore completes so a quick first import cannot race
  // the initial library load or report "saved" before storage is ready.
  await libraryReady;
  const files = Array.from(event.target.files || []);

  const audioFiles = files.filter(file =>
    file.type.startsWith("audio/") ||
    /\.(mp3|m4a|aac|wav|ogg|flac|opus|weba|aiff?)$/i.test(file.name)
  );

  if (!audioFiles.length) {
    if (files.length) {
      setStatus("No supported audio files found.");
    }

    fileInput.value = "";
    return;
  }

  const known = new Set(songs.map(song => `${song.fileName || song.file.name}|${song.file.size}|${song.fileLastModified || song.file.lastModified || 0}`));
  const uniqueFiles = audioFiles.filter(file => {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (known.has(key)) return false;
    known.add(key); return true;
  });
  const newSongs = await Promise.all(uniqueFiles.map(async file => {
    const embeddedArtwork = await extractEmbeddedArtwork(file);
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      file, fileName: file.name, fileLastModified: file.lastModified, url: URL.createObjectURL(file),
      title: file.name.replace(/\.[^.]+$/, ""), artist: "Local audio", duration: 0,
      embeddedArtwork, embeddedArtworkUrl: embeddedArtwork ? URL.createObjectURL(embeddedArtwork) : "",
      customArtwork: null, customArtworkUrl: ""
    };
  }));

  songs.push(...newSongs);
  renderPlaylist();
  try {
    await persistLibrary();
    setStatus(newSongs.length ? `${newSongs.length} new song(s) saved to this browser` : "No new songs found • duplicates skipped");
  } catch (error) {
    setStatus("Songs were added for this session, but storage failed. Keep the original files and check browser storage permissions.");
  }

  // Automatically start playing if this is the first selection.
  if (currentIndex === -1 && songs.length > 0) {
    loadSong(0, true);
  }

  // Let the user select the same file again later.
  fileInput.value = "";
});

// Load and play a song by its playlist index.
async function loadSong(index, autoplay = false) {
  if (!songs.length) return;

  index = (index + songs.length) % songs.length;
  currentIndex = index;

  const song = songs[currentIndex];
  rememberRecentlyPlayed(song);
  const request = ++playRequest;

  audio.pause();
  audio.src = song.url;
  audio.load();

  songTitle.textContent = song.title;
  songArtist.textContent = song.artist;
  renderArtwork(song);
  currentTimeEl.textContent = "0:00";
  durationEl.textContent = "0:00";
  seekBar.value = 0;

  updateFavoriteButton();
  renderPlaylist();
  updateMiniPlayer();

  setStatus("Song selected");

  if (autoplay) {
    try {
      await audio.play();

      if (request === playRequest) {
        setStatus("Now playing");
      }
    } catch (error) {
      if (request === playRequest) {
        setStatus("Tap play to start this song");
      }
    }
  }
}

function updatePlayButton() {
  const playing = !audio.paused && !audio.ended;

  playBtn.textContent = playing ? "Ⅱ" : "▶";
  playBtn.setAttribute(
    "aria-label", playing ? "Pause" : "Play"
  );
}

playBtn.addEventListener("click", async () => {
  if (currentIndex === -1) {
    if (songs.length) {
      await loadSong(0, true);
    } else {
      openFilePicker();
    }

    return;
  }

  if (audio.paused) {
    try {
      ensureAudioGraph();
      await audio.play();
      setStatus("Now playing");
    } catch (error) {
      setStatus("Unable to play this file. Try another format.");
    }
  } else {
    audio.pause();
    setStatus("Playback paused");
  }

  updatePlayButton();
});

prevBtn.addEventListener("click", () => {
  if (!songs.length) {
    openFilePicker();
    return;
  }

  // Restart the current song if it has played for over 3 seconds.
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  playPrevious();
});

function playPrevious() {
  if (!songs.length) return;

  const wasPlaying = !audio.paused;

  let index = currentIndex - 1;

  if (shuffle && songs.length > 1) {
    index = getRandomIndex();
  }

  loadSong(index < 0 ? songs.length - 1 : index, wasPlaying);
}

nextBtn.addEventListener("click", () => {
  if (!songs.length) {
    openFilePicker();
    return;
  }

  playNext();
});

function getRandomIndex() {
  if (songs.length < 2) return currentIndex;

  let index;

  do {
    index = Math.floor(Math.random() * songs.length);
  } while (index === currentIndex);

  return index;
}

function playNext() {
  if (!songs.length) return;

  const index = shuffle
    ? getRandomIndex()
    : (currentIndex + 1) % songs.length;

  loadSong(index, true);
}

// Shuffle control.
shuffleBtn.addEventListener("click", () => {
  shuffle = !shuffle;

  shuffleBtn.classList.toggle("active", shuffle);
  shuffleBtn.setAttribute("aria-pressed", String(shuffle));

  setStatus(shuffle ? "Shuffle enabled" : "Shuffle disabled");
});

// Repeat cycles through off, repeat-all, and repeat-one.
repeatBtn.addEventListener("click", () => {
  const modes = ["off", "all", "one"];
  const index = modes.indexOf(repeatMode);

  repeatMode = modes[(index + 1) % modes.length];

  repeatBtn.classList.toggle("active", repeatMode !== "off");
  repeatBtn.textContent = repeatMode === "one" ? "↻¹" : "↻";

  repeatBtn.setAttribute(
    "aria-label", `Repeat ${repeatMode}`
  );
  repeatBtn.setAttribute(
    "aria-pressed", String(repeatMode !== "off")
  );

  audio.loop = repeatMode === "one";

  setStatus(
    repeatMode === "off" ? "Repeat disabled" :
    repeatMode === "all" ? "Repeat playlist enabled" :
    "Repeat one enabled"
  );
});

// Playback progress and duration.
audio.addEventListener("loadedmetadata", () => {
  if (currentIndex < 0) return;

  const duration = audio.duration;
  songs[currentIndex].duration = duration;
  persistLibrary();

  durationEl.textContent = formatTime(duration);
  renderPlaylist();
});

audio.addEventListener("timeupdate", () => {
  if (!isSeeking && Number.isFinite(audio.duration) &&
      audio.duration > 0) {
    seekBar.value = Math.round(
      (audio.currentTime / audio.duration) * 1000
    );
  }

  currentTimeEl.textContent = formatTime(audio.currentTime);
});

seekBar.addEventListener("input", () => {
  isSeeking = true;

  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    currentTimeEl.textContent = formatTime(
      (Number(seekBar.value) / 1000) * audio.duration
    );
  }
});

function finishSeeking() {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime =
      (Number(seekBar.value) / 1000) * audio.duration;
  }

  isSeeking = false;
}

seekBar.addEventListener("change", finishSeeking);
seekBar.addEventListener("pointerup", finishSeeking);
seekBar.addEventListener("touchend", finishSeeking);

// Volume.
const volumeValue = document.getElementById("volumeValue");
const muteBtn = document.getElementById("muteBtn");
let previousVolume = Number(volumeBar.value) || 80;
function syncVolumeUI() {
  const value = Math.round(audio.volume * 100);
  volumeBar.value = String(value);
  volumeBar.setAttribute("aria-valuetext", `${value} percent`);
  if (volumeValue) volumeValue.textContent = `${value}%`;
  if (muteBtn) {
    muteBtn.setAttribute("aria-pressed", String(audio.muted || audio.volume === 0));
    muteBtn.setAttribute("aria-label", audio.muted || audio.volume === 0 ? "Unmute volume" : "Mute volume");
    muteBtn.textContent = audio.muted || audio.volume === 0 ? "×" : "◖))";
  }
}
audio.volume = Number(volumeBar.value) / 100;
volumeBar.addEventListener("input", () => {
  audio.muted = false;
  audio.volume = Number(volumeBar.value) / 100;
  if (audio.volume > 0) previousVolume = audio.volume * 100;
  syncVolumeUI();
});
muteBtn?.addEventListener("click", () => {
  if (audio.muted || audio.volume === 0) {
    audio.muted = false;
    audio.volume = Math.max(0.05, Math.min(1, previousVolume / 100));
  } else {
    previousVolume = audio.volume * 100;
    audio.muted = true;
  }
  syncVolumeUI();
});
syncVolumeUI();

// When a song ends, move to the next track if appropriate.
audio.addEventListener("ended", () => {
  if (repeatMode === "one") return;

  if (currentIndex < songs.length - 1 ||
      repeatMode === "all" || shuffle) {
    playNext();
  } else {
    updatePlayButton();
    setStatus("Playlist finished");
  }
});

audio.addEventListener("play", () => { updatePlayButton(); updateMiniPlayer(); });
audio.addEventListener("pause", () => { updatePlayButton(); updateMiniPlayer(); });

audio.addEventListener("error", () => {
  if (currentIndex !== -1) {
    setStatus("Cannot play this file. Try another audio format.");
  }

  updatePlayButton();
});

// Favorites are stored for this session.
favoriteBtn.addEventListener("click", () => {
  if (currentIndex === -1) {
    setStatus("Choose a song first");
    return;
  }

  const id = songs[currentIndex].id;

  if (favorites.has(id)) {
    favorites.delete(id);
  } else {
    favorites.add(id);
  }

  updateFavoriteButton();
  renderPlaylist();
  persistLibrary();
});

function updateFavoriteButton() {
  const song = songs[currentIndex];
  const liked = song && favorites.has(song.id);

  favoriteBtn.textContent = liked ? "♥" : "♡";
  favoriteBtn.classList.toggle("active", Boolean(liked));
  favoriteBtn.setAttribute("aria-pressed", String(Boolean(liked)));
}

// Search songs by title or artist.
searchInput.addEventListener("input", renderPlaylist);

function renderPlaylist() {
  const query = searchInput.value.trim().toLowerCase();
  songList.replaceChildren();

  songs.forEach((song, index) => {
    const matchesQuery = song.title.toLowerCase().includes(query) || song.artist.toLowerCase().includes(query);
    const matchesFavorite = libraryFilter !== "favorites" || favorites.has(song.id);
    const activePlaylist = playlists.find(p => p.id === selectedPlaylist);
    const matchesPlaylist = !activePlaylist || activePlaylist.songIds.includes(song.id);
    if (!matchesQuery || !matchesFavorite || !matchesPlaylist) return;

    const row = document.createElement("div");
    row.className = "song-row" +
      (index === currentIndex ? " current" : "");

    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Play ${song.title}`);

    const thumb = document.createElement("div");
    thumb.className = "song-thumb";
    if (song.customArtworkUrl || song.embeddedArtworkUrl) {
      const thumbImg = document.createElement("img");
      thumbImg.src = song.customArtworkUrl || song.embeddedArtworkUrl;
      thumbImg.alt = ""; thumb.appendChild(thumbImg);
    } else { thumb.textContent = "♫"; }

    const meta = document.createElement("div");
    meta.className = "song-meta";

    const title = document.createElement("h3");
    title.textContent = song.title;

    const artist = document.createElement("p");
    artist.textContent = song.artist +
      (favorites.has(song.id) ? "  ♥" : "");

    meta.append(title, artist);

    const duration = document.createElement("span");
    duration.className = "song-duration";
    duration.textContent = formatTime(song.duration);

    const playIcon = document.createElement("span");
    playIcon.className = "song-play";
    playIcon.textContent =
      index === currentIndex && !audio.paused ? "Ⅱ" : "▶";

    const actions = document.createElement("div");
    actions.className = "song-actions";
    const playlistBtn = document.createElement("button");
    playlistBtn.className = "playlist-song-btn";
    playlistBtn.type = "button";
    playlistBtn.textContent = "+ List";
    playlistBtn.setAttribute("aria-label", `Add ${song.title} to playlist`);
    playlistBtn.addEventListener("click", event => { event.stopPropagation(); addSongToPlaylist(song); });
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-song";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("aria-label", `Delete ${song.title}`);
    deleteBtn.addEventListener("click", async event => {
      event.stopPropagation();
      const deletingCurrent = index === currentIndex;
      if (deletingCurrent) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        playRequest++;
      }
      await deleteSongRecord(song.id);
      URL.revokeObjectURL(song.url);
      favorites.delete(song.id);
      songs.splice(index, 1);
      if (!songs.length) {
        currentIndex = -1;
        songTitle.textContent = "No song selected";
        songArtist.textContent = "Choose music from your device";
        currentTimeEl.textContent = "0:00";
        durationEl.textContent = "0:00";
        seekBar.value = 0;
        updateFavoriteButton();
        renderArtwork(null);
      } else if (deletingCurrent) {
        currentIndex = -1;
        loadSong(Math.min(index, songs.length - 1), false);
      } else if (index < currentIndex) {
        currentIndex--;
      }
      renderPlaylist();
      persistLibrary();
      setStatus("Song deleted from your library");
    });
    actions.append(playIcon, playlistBtn, deleteBtn);
    row.append(thumb, meta, duration, actions);

    const selectSong = () => { loadSong(index, true); showPage("playingView"); };

    row.addEventListener("click", selectSong);

    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectSong();
      }
    });

    songList.appendChild(row);
  });

  songCount.textContent = `(${songs.length})`;
  emptyState.hidden = songs.length > 0;
  renderHomeDashboard();
  updateMiniPlayer();

  if (songs.length > 0 && songList.children.length === 0) {
    const message = document.createElement("p");
    message.className = "subtext";
    message.textContent = "No songs match your search.";
    songList.appendChild(message);
  }
}

// Quantum v1.0.6 enhancements: playlists, live visualizer, themes, EQ and media controls.
let libraryFilter = "all";
let selectedPlaylist = "all";
let playlists = [];
try { playlists = JSON.parse(localStorage.getItem("quantum-playlists-v106") || "[]"); if (!Array.isArray(playlists)) playlists = []; } catch (_) { playlists = []; }
let audioContext = null;
let analyser = null;
let bassFilter = null;
let trebleFilter = null;
let lowMidFilter = null;
let midFilter = null;
let highMidFilter = null;
let sourceNode = null;
let visualizerFrame = 0;

// Initialize after playlist state is defined so the first render is safe.
renderPlaylist();
updatePlayButton();
const libraryReady = restoreLibrary();

function ensureAudioGraph() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    setStatus("Audio effects are not supported in this browser.");
    return false;
  }
  if (!audioContext) {
    audioContext = new AudioContextClass();
    sourceNode = audioContext.createMediaElementSource(audio);
    bassFilter = audioContext.createBiquadFilter();
    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 120;
    lowMidFilter = audioContext.createBiquadFilter();
    lowMidFilter.type = "peaking";
    lowMidFilter.frequency.value = 250;
    lowMidFilter.Q.value = 0.9;
    midFilter = audioContext.createBiquadFilter();
    midFilter.type = "peaking";
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 0.9;
    highMidFilter = audioContext.createBiquadFilter();
    highMidFilter.type = "peaking";
    highMidFilter.frequency.value = 4000;
    highMidFilter.Q.value = 0.9;
    trebleFilter = audioContext.createBiquadFilter();
    trebleFilter.type = "highshelf";
    trebleFilter.frequency.value = 10000;
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    sourceNode.connect(bassFilter);
    bassFilter.connect(lowMidFilter);
    lowMidFilter.connect(midFilter);
    midFilter.connect(highMidFilter);
    highMidFilter.connect(trebleFilter);
    trebleFilter.connect(analyser);
    analyser.connect(audioContext.destination);
    applyEQ();
  }
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return true;
}

function updateEQLabels() {
  const bands = [
    ["bassRange", "bassValue"],
    ["lowMidRange", "lowMidValue"],
    ["midRange", "midValue"],
    ["highMidRange", "highMidValue"],
    ["trebleRange", "trebleValue"]
  ];
  bands.forEach(([rangeId, outputId]) => {
    const range = document.getElementById(rangeId);
    const output = document.getElementById(outputId);
    if (range && output) output.textContent = `${Number(range.value)} dB`;
  });
}
function applyEQ() {
  const value = id => Number(document.getElementById(id).value);
  if (bassFilter && lowMidFilter && midFilter && highMidFilter && trebleFilter) {
    bassFilter.gain.value = value("bassRange");
    lowMidFilter.gain.value = value("lowMidRange");
    midFilter.gain.value = value("midRange");
    highMidFilter.gain.value = value("highMidRange");
    trebleFilter.gain.value = value("trebleRange");
  }
  updateEQLabels();
}
const eqPreset = document.getElementById("eqPreset");
const eqPresets = {
  normal: [0, 0, 0, 0, 0],
  bass: [8, 4, 1, 0, 0],
  treble: [0, 0, 1, 4, 7],
  vocal: [-2, 1, 4, 3, 1],
  balanced: [3, 2, 1, 2, 1]
};
function applyEQPreset(name) {
  const values = eqPresets[name] || eqPresets.normal;
  ["bassRange", "lowMidRange", "midRange", "highMidRange", "trebleRange"].forEach((id, index) => {
    document.getElementById(id).value = String(values[index]);
  });
  ensureAudioGraph();
  applyEQ();
}
["bassRange", "lowMidRange", "midRange", "highMidRange", "trebleRange"].forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    if (eqPreset) eqPreset.value = "normal";
    ensureAudioGraph();
    applyEQ();
  });
});
eqPreset?.addEventListener("change", () => applyEQPreset(eqPreset.value));
updateEQLabels();

const visualizerCanvas = document.getElementById("visualizer");
const visualizerCtx = visualizerCanvas.getContext("2d");
function drawVisualizer() {
  const rect = visualizerCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (visualizerCanvas.width !== Math.round(rect.width * dpr) || visualizerCanvas.height !== Math.round(rect.height * dpr)) {
    visualizerCanvas.width = Math.round(rect.width * dpr);
    visualizerCanvas.height = Math.round(rect.height * dpr);
  }
  visualizerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width, height = rect.height;
  visualizerCtx.clearRect(0, 0, width, height);
  const bars = 36;
  const data = new Uint8Array(analyser ? analyser.frequencyBinCount : bars);
  if (analyser && !audio.paused) analyser.getByteFrequencyData(data);
  for (let i = 0; i < bars; i++) {
    const value = analyser && !audio.paused ? data[i % data.length] / 255 : 0.08 + Math.abs(Math.sin(Date.now()/700+i*.65))*.13;
    const barHeight = Math.max(3, value * height * .92);
    const x = i * (width / bars);
    const gradient = visualizerCtx.createLinearGradient(0, height, 0, height-barHeight);
    gradient.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue('--purple').trim());
    gradient.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue('--pink').trim());
    visualizerCtx.fillStyle = gradient;
    visualizerCtx.fillRect(x + 1, height-barHeight, Math.max(2, width/bars-3), barHeight);
  }
  visualizerFrame = requestAnimationFrame(drawVisualizer);
}

const themeChoices = {
  quantum: ["#06101b", "#0b1b2b", "#10263a", "#38bdf8", "#c084fc"],
  ocean: ["#06111b", "#0d1c2a", "#12283a", "#38bdf8", "#67e8f9"],
  ember: ["#170b0a", "#26120f", "#351a15", "#f97316", "#fbbf24"],
  mono: ["#09090b", "#18181b", "#27272a", "#a1a1aa", "#f4f4f5"]
};
document.getElementById("themeSelect").addEventListener("change", event => {
  const theme = themeChoices[event.target.value] || themeChoices.quantum;
  const root = document.documentElement;
  ["--bg", "--panel", "--panel2", "--purple", "--pink"].forEach((key, i) => root.style.setProperty(key, theme[i]));
  localStorage.setItem("quantum-theme-v106", event.target.value);
});
const savedTheme = localStorage.getItem("quantum-theme-v106");
if (savedTheme && themeChoices[savedTheme]) {
  document.getElementById("themeSelect").value = savedTheme;
  document.getElementById("themeSelect").dispatchEvent(new Event("change"));
}

function savePlaylists() { localStorage.setItem("quantum-playlists-v106", JSON.stringify(playlists)); }
document.getElementById("createPlaylistBtn").addEventListener("click", () => {
  const name = prompt("Name your playlist:");
  if (!name || !name.trim()) return;
  const clean = name.trim().slice(0, 40);
  if (playlists.some(p => p.name.toLowerCase() === clean.toLowerCase())) {
    setStatus("A playlist with that name already exists."); return;
  }
  playlists.push({ id: `pl-${Date.now()}`, name: clean, songIds: [] });
  savePlaylists(); renderPlaylistChips(); selectedPlaylist = playlists[playlists.length - 1].id; renderPlaylist();
  setStatus(`Playlist created: ${clean}`);
});
function renderPlaylistChips() {
  const holder = document.getElementById("playlistChips");
  holder.replaceChildren();
  const entries = [{id:"all", name:"All"}, ...playlists.map(p => ({id:p.id, name:p.name}))];
  entries.forEach(item => {
    const chip = document.createElement("button");
    chip.className = "playlist-chip" + (selectedPlaylist === item.id ? " active" : "");
    chip.textContent = item.name;
    chip.addEventListener("click", () => { selectedPlaylist = item.id; libraryFilter = "all"; updateFilterButtons(); renderPlaylistChips(); renderPlaylist(); });
    holder.appendChild(chip);
  });
}
function updateFilterButtons() {
  document.querySelectorAll(".filter-tab").forEach(btn => {
    const active = btn.dataset.filter === libraryFilter;
    btn.classList.toggle("active", active); btn.setAttribute("aria-pressed", String(active));
  });
}
document.querySelectorAll(".filter-tab").forEach(btn => btn.addEventListener("click", () => {
  libraryFilter = btn.dataset.filter; selectedPlaylist = "all"; updateFilterButtons(); renderPlaylistChips(); renderPlaylist();
}));

// A song can be added to a playlist from its row action menu.
function addSongToPlaylist(song) {
  if (!playlists.length) { setStatus("Create a playlist first."); return; }
  const choice = prompt("Add to which playlist?\n" + playlists.map((p, i) => `${i+1}. ${p.name}`).join("\n") + "\nEnter a number:");
  const index = Number(choice) - 1;
  if (!Number.isInteger(index) || !playlists[index]) return;
  if (!playlists[index].songIds.includes(song.id)) playlists[index].songIds.push(song.id);
  savePlaylists(); renderPlaylist(); setStatus(`Added to ${playlists[index].name}`);
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || currentIndex < 0 || !songs[currentIndex]) return;
  const song = songs[currentIndex];
  try {
    const artwork = song.customArtworkUrl || song.embeddedArtworkUrl;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title, artist: song.artist, album: "Quantum Music",
      ...(artwork ? { artwork: [{ src: artwork, sizes: "512x512", type: song.customArtwork?.type || song.embeddedArtwork?.type || "image/jpeg" }] } : {})
    });
  } catch (_) {}
  const actions = {
    play: () => { ensureAudioGraph(); audio.play().catch(() => {}); },
    pause: () => audio.pause(),
    previoustrack: () => playPrevious(),
    nexttrack: () => playNext(),
    seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); },
    seekforward: details => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); },
    seekto: details => { if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime; }
  };
  Object.entries(actions).forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {} });
}
audio.addEventListener("play", () => { ensureAudioGraph(); updateMediaSession(); });

// Improve song identity so selecting the same file twice doesn't duplicate it.
const originalFileChangeHandler = fileInput.onchange;

renderPlaylistChips();
updateMiniPlayer();
if (!visualizerFrame) drawVisualizer();



// Contextual Playing page and persistent mini-player.
function updateMiniPlayer() {
  const mini = document.getElementById("miniPlayer");
  if (!mini) return;
  const song = currentIndex >= 0 ? songs[currentIndex] : null;
  mini.hidden = !song;
  if (!song) return;
  const title = document.getElementById("miniPlayerTitle");
  const artist = document.getElementById("miniPlayerArtist");
  const art = document.getElementById("miniPlayerArt");
  const toggle = document.getElementById("miniPlayerToggle");
  if (title) title.textContent = song.title || "Unknown track";
  if (artist) artist.textContent = song.artist || "Local audio";
  if (art) {
    const artwork = song.customArtworkUrl || song.embeddedArtworkUrl;
    art.replaceChildren();
    if (artwork) { const img = document.createElement("img"); img.src = artwork; img.alt = ""; art.appendChild(img); }
    else art.textContent = "♫";
  }
  if (toggle) { toggle.textContent = (!audio.paused && !audio.ended) ? "Ⅱ" : "▶"; toggle.setAttribute("aria-label", (!audio.paused && !audio.ended) ? "Pause" : "Play"); }
}
function focusPlayerSection() {
  if (currentIndex >= 0) showPage("playingView");
  else { showPage("homeView"); document.getElementById("homeLibrarySection")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

// Navigation between the app's dedicated pages.
function showPage(pageId) {
  if (pageId === "playingView" && currentIndex < 0) pageId = "homeView";
  document.querySelectorAll(".page-view").forEach(page => page.classList.toggle("active", page.id === pageId));
  document.querySelectorAll(".nav-item").forEach(btn => {
    const activePage = pageId === "playingView" ? "homeView" : pageId;
    const active = btn.dataset.page === activePage;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page"); else btn.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: document.documentElement.classList.contains("reduced-motion") ? "auto" : "smooth" });
}
document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.page)));
document.getElementById("playingBackBtn")?.addEventListener("click", () => showPage("homeView"));

// Equalizer opens as a grouped pop-out inside the Playing page.
const equalizerOverlay = document.getElementById("equalizerOverlay");
const equalizerLaunchBtn = document.getElementById("equalizerLaunchBtn");
const equalizerCloseBtn = document.getElementById("equalizerCloseBtn");
function setEqualizerOpen(open) {
  if (!equalizerOverlay || !equalizerLaunchBtn) return;
  equalizerOverlay.hidden = !open;
  equalizerOverlay.setAttribute("aria-hidden", String(!open));
  equalizerLaunchBtn.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("equalizer-open", open);
  if (open) equalizerCloseBtn?.focus();
  else equalizerLaunchBtn.focus({ preventScroll: true });
}
equalizerLaunchBtn?.addEventListener("click", () => setEqualizerOpen(equalizerOverlay?.hidden ?? true));
equalizerCloseBtn?.addEventListener("click", () => setEqualizerOpen(false));
equalizerOverlay?.addEventListener("click", event => { if (event.target === equalizerOverlay) setEqualizerOpen(false); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && equalizerOverlay && !equalizerOverlay.hidden) setEqualizerOpen(false);
});
// Sleep timer opens as a pop-out inside the Playing page.
const sleepTimerOverlay = document.getElementById("sleepTimerOverlay");
const sleepTimerLaunchBtn = document.getElementById("sleepTimerLaunchBtn");
const sleepTimerCloseBtn = document.getElementById("sleepTimerCloseBtn");
function setSleepTimerOpen(open) {
  if (!sleepTimerOverlay || !sleepTimerLaunchBtn) return;
  sleepTimerOverlay.hidden = !open;
  sleepTimerOverlay.setAttribute("aria-hidden", String(!open));
  sleepTimerLaunchBtn.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("sleep-timer-open", open);
  if (open) sleepTimerCloseBtn?.focus();
  else sleepTimerLaunchBtn.focus({ preventScroll: true });
}
sleepTimerLaunchBtn?.addEventListener("click", () => setSleepTimerOpen(sleepTimerOverlay?.hidden ?? true));
sleepTimerCloseBtn?.addEventListener("click", () => setSleepTimerOpen(false));
sleepTimerOverlay?.addEventListener("click", event => { if (event.target === sleepTimerOverlay) setSleepTimerOpen(false); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && sleepTimerOverlay && !sleepTimerOverlay.hidden) setSleepTimerOpen(false);
});

document.getElementById("miniPlayerOpen")?.addEventListener("click", () => showPage("playingView"));
document.getElementById("miniPlayerToggle")?.addEventListener("click", async () => {
  if (currentIndex < 0) return;
  if (audio.paused) { try { ensureAudioGraph(); await audio.play(); setStatus("Now playing"); } catch (_) { setStatus("Tap play to start this song"); } }
  else { audio.pause(); setStatus("Playback paused"); }
  updatePlayButton(); updateMiniPlayer();
});
document.getElementById("homePlayBtn")?.addEventListener("click", () => focusPlayerSection());
document.getElementById("homeLibraryBtn")?.addEventListener("click", () => document.getElementById("homeLibrarySection")?.scrollIntoView({ behavior: "smooth", block: "start" }));
document.getElementById("homeImportBtn")?.addEventListener("click", openFilePicker);
document.getElementById("homeAddMoreBtn")?.addEventListener("click", openFilePicker);
document.getElementById("homeLibraryViewBtn")?.addEventListener("click", () => document.getElementById("homeLibrarySection")?.scrollIntoView({ behavior: "smooth", block: "start" }));
document.getElementById("homeRecentViewBtn")?.addEventListener("click", () => document.getElementById("homeLibrarySection")?.scrollIntoView({ behavior: "smooth", block: "start" }));
document.getElementById("homeAddedViewBtn")?.addEventListener("click", () => document.getElementById("homeLibrarySection")?.scrollIntoView({ behavior: "smooth", block: "start" }));
document.getElementById("homeFeaturePlayBtn")?.addEventListener("click", async () => {
  if (!songs.length) { openFilePicker(); return; }
  if (currentIndex < 0) await loadSong(songs.length - 1, true);
  showPage("playingView");
});

// Custom artwork takes priority over embedded artwork; reset returns to embedded art or fallback.
const artworkInput = document.getElementById("artworkInput");
document.getElementById("customArtworkBtn")?.addEventListener("click", () => {
  if (currentIndex < 0) { setStatus("Choose a song before adding custom artwork."); return; }
  artworkInput.click();
});
artworkInput?.addEventListener("change", async () => {
  const file = artworkInput.files && artworkInput.files[0];
  if (!file || currentIndex < 0) { artworkInput.value = ""; return; }
  if (!file.type.startsWith("image/")) { setStatus("Choose an image file for artwork."); artworkInput.value = ""; return; }
  const song = songs[currentIndex];
  if (song.customArtworkUrl) URL.revokeObjectURL(song.customArtworkUrl);
  song.customArtwork = file;
  song.customArtworkUrl = URL.createObjectURL(file);
  renderArtwork(song); renderPlaylist();
  try { await persistLibrary(); setStatus("Custom artwork saved for this song."); }
  catch (_) { setStatus("Artwork applied for this session, but could not be saved."); }
  artworkInput.value = "";
});
document.getElementById("resetArtworkBtn")?.addEventListener("click", async () => {
  if (currentIndex < 0) { setStatus("Choose a song first."); return; }
  const song = songs[currentIndex];
  if (song.customArtworkUrl) URL.revokeObjectURL(song.customArtworkUrl);
  song.customArtwork = null; song.customArtworkUrl = "";
  renderArtwork(song); renderPlaylist();
  try { await persistLibrary(); setStatus(song.embeddedArtwork ? "Using embedded artwork." : "Using default Quantum cover."); }
  catch (_) { setStatus("Cover reset for this session, but could not be saved."); }
});

// Backup exports saved song blobs and metadata as a JSON file, along with playlists and theme settings.
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
}
function dataUrlToBlob(dataUrl) {
  const [head, data] = dataUrl.split(","); const mime = (head.match(/data:([^;]+)/) || [,"application/octet-stream"])[1];
  const binary = atob(data); const bytes = new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); return new Blob([bytes], {type:mime});
}
document.getElementById("exportBackupBtn")?.addEventListener("click", async () => {
  await libraryReady;
  try {
    const records = await new Promise((resolve, reject) => { const tx=db.transaction(STORE_NAME,"readonly"); const req=tx.objectStore(STORE_NAME).getAll(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error); });
    const packed=[];
    for (const r of records) packed.push({ ...r, blob: r.blob ? await blobToDataUrl(r.blob) : null, embeddedArtwork: r.embeddedArtwork ? await blobToDataUrl(r.embeddedArtwork) : null, customArtwork: r.customArtwork ? await blobToDataUrl(r.customArtwork) : null });
    const backup={ app:"Quantum Music Player", version:"1.0.6", createdAt:new Date().toISOString(), songs:packed, playlists, theme:localStorage.getItem("quantum-theme-v106"), reducedMotion:localStorage.getItem("quantum-reduced-motion-v106") };
    const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:"application/json"})); const a=document.createElement("a"); a.href=url; a.download="quantum-music-player-v1.0.6-backup.json"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); setStatus("Library backup exported. Keep this file somewhere safe.");
  } catch (error) { setStatus("Backup failed. Check available storage and try again."); }
});
document.getElementById("importBackupBtn")?.addEventListener("click", () => document.getElementById("backupInput").click());
document.getElementById("backupInput")?.addEventListener("change", async event => {
  const file=event.target.files && event.target.files[0]; if (!file) return;
  try {
    const backup=JSON.parse(await file.text());
    if (!backup || backup.app !== "Quantum Music Player" || !Array.isArray(backup.songs)) throw new Error("Invalid backup");
    if (!confirm(`Restore ${backup.songs.length} song record(s)? Existing records with the same IDs will be updated. This cannot recover files removed from the backup.`)) { event.target.value=""; return; }
    await libraryReady;
    const tx=db.transaction(STORE_NAME,"readwrite"); const store=tx.objectStore(STORE_NAME);
    for (const r of backup.songs) store.put({ ...r, blob: typeof r.blob === "string" ? dataUrlToBlob(r.blob) : r.blob, embeddedArtwork: typeof r.embeddedArtwork === "string" ? dataUrlToBlob(r.embeddedArtwork) : r.embeddedArtwork, customArtwork: typeof r.customArtwork === "string" ? dataUrlToBlob(r.customArtwork) : r.customArtwork });
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});
    if (Array.isArray(backup.playlists)) { playlists=backup.playlists; savePlaylists(); }
    if (backup.theme && themeChoices[backup.theme]) { localStorage.setItem("quantum-theme-v106",backup.theme); document.getElementById("themeSelect").value=backup.theme; document.getElementById("themeSelect").dispatchEvent(new Event("change")); }
    await restoreLibrary(); renderPlaylist(); renderPlaylistChips(); setStatus("Backup restored. Review your library before deleting the backup file.");
  } catch (error) { setStatus("Could not restore this backup. Check that it is a valid Quantum Music Player backup."); }
  event.target.value="";
});

const reducedMotionBtn=document.getElementById("reducedMotionBtn");
function setReducedMotion(enabled) { document.documentElement.classList.toggle("reduced-motion",enabled); localStorage.setItem("quantum-reduced-motion-v106",enabled?"true":"false"); if (reducedMotionBtn) { reducedMotionBtn.textContent=`Reduced motion: ${enabled?"On":"Off"}`; reducedMotionBtn.setAttribute("aria-pressed",String(enabled)); } }
reducedMotionBtn?.addEventListener("click",()=>setReducedMotion(!document.documentElement.classList.contains("reduced-motion")));
setReducedMotion(localStorage.getItem("quantum-reduced-motion-v106")==="true");


// YouTube search via Cloudflare Worker backend (v1.0.9).
(() => {
  const form = document.getElementById("youtubeSearchForm");
  const queryInput = document.getElementById("youtubeQuery");
  const searchBtn = document.getElementById("youtubeSearchBtn");
  const status = document.getElementById("youtubeStatus");
  const secureStatus = document.getElementById("secureYoutubeStatus");
  const keyState = document.getElementById("youtubeKeyState");
  const results = document.getElementById("youtubeResults");
  const playerWrap = document.getElementById("youtubePlayerWrap");
  const player = document.getElementById("youtubePlayer");
  if (!form || !queryInput) return;

  // Public endpoint only; the YouTube API key remains in the Cloudflare Worker secret.
  const SEARCH_ENDPOINT = "https://quantum-music-search.larnqua43.workers.dev/search";

  function setMessage(message) { if (status) status.textContent = message; }
  function safeText(value) { return String(value || ""); }

  if (keyState) {
    keyState.textContent = "Connected via server";
    keyState.classList.add("is-configured");
  }
  if (secureStatus) {
    secureStatus.textContent = "Online search uses the Quantum Music Search server. No API key is needed or stored in this app.";
  }
  document.getElementById("openSecureSettingsBtn")?.addEventListener("click", () => {
    if (typeof showPage === "function") showPage("secureSettingsView");
  });
  document.getElementById("backFromSecureSettingsBtn")?.addEventListener("click", () => {
    if (typeof showPage === "function") showPage("settingsView");
  });

  function playVideo(videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
    player.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&playsinline=1&rel=0";
    playerWrap.hidden = false;
    playerWrap.scrollIntoView({ behavior: document.documentElement.classList.contains("reduced-motion") ? "auto" : "smooth", block: "nearest" });
    setMessage("Playing selected YouTube video. Playback and availability are controlled by YouTube.");
  }

  function renderResults(items) {
    results.replaceChildren();
    if (!items.length) { setMessage("No videos found. Try another search phrase."); return; }
    items.forEach(item => {
      const id = item && (item.videoId || (item.id && item.id.videoId));
      const titleText = item && (item.title || (item.snippet && item.snippet.title));
      const channelText = item && (item.channelTitle || (item.snippet && item.snippet.channelTitle));
      const thumbnailUrl = item && (item.thumbnail || (item.snippet && item.snippet.thumbnails && ((item.snippet.thumbnails.medium || item.snippet.thumbnails.high || item.snippet.thumbnails.default) || {}).url));
      if (!id || !titleText) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "youtube-result";
      button.setAttribute("aria-label", "Play " + safeText(titleText));
      const image = document.createElement("img");
      image.className = "youtube-thumb";
      image.loading = "lazy";
      image.alt = "";
      image.src = safeText(thumbnailUrl);
      const copy = document.createElement("span");
      copy.className = "youtube-result-copy";
      const title = document.createElement("span");
      title.className = "youtube-result-title";
      title.textContent = safeText(titleText);
      const channel = document.createElement("span");
      channel.className = "youtube-result-channel";
      channel.textContent = safeText(channelText);
      const play = document.createElement("span");
      play.className = "youtube-result-play";
      play.textContent = "▶ Play video";
      copy.append(title, channel, play);
      button.append(image, copy);
      button.addEventListener("click", () => playVideo(id));
      results.append(button);
    });
    setMessage(results.children.length ? "Found " + results.children.length + " video result(s). Tap one to play." : "No playable results returned. Try another search phrase.");
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const query = queryInput.value.trim();
    if (!query) { setMessage("Enter a song or artist to search."); queryInput.focus(); return; }
    if (query.length > 150) { setMessage("Search is limited to 150 characters."); return; }
    searchBtn.disabled = true;
    searchBtn.textContent = "Searching…";
    results.replaceChildren();
    setMessage("Searching YouTube…");
    try {
      const endpoint = new URL(SEARCH_ENDPOINT);
      endpoint.searchParams.set("q", query);
      const response = await fetch(endpoint.toString(), { method: "GET", headers: { "Accept": "application/json" } });
      let data;
      try { data = await response.json(); } catch (_) { throw new Error("Search server returned an invalid response."); }
      if (!response.ok) throw new Error(data && data.error ? data.error : "YouTube search failed. Please try again later.");
      renderResults(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setMessage(error && error.message ? error.message : "Could not connect to the search server. Check your internet connection.");
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "Search";
    }
  });
})();
