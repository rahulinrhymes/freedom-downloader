const express = require('express');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const app = express();
const port = process.env.PORT || 3000;
const cors = require('cors');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/formats', async (req, res) => {
  try {
    const videoUrl = req.query.url;
    if (!videoUrl) {
      return res.status(400).json({ success: false, message: "URL is required" });
    }

    exec(`yt-dlp -J "${videoUrl}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Format Fetch Error:', error.message);
        return res.status(500).json({
          success: false,
          message: `Failed to fetch formats: ${stderr || error.message}`
        });
      }

      try {
        const info = JSON.parse(stdout);
        if (!info.formats || info.formats.length === 0) {
          return res.status(500).json({ success: false, message: "No formats found in video information" });
        }
        res.json({ success: true, formats: info.formats });
      } catch (err) {
        console.error('JSON Parse Error:', err);
        return res.status(500).json({ success: false, message: "Error parsing video information" });
      }
    });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get('/download', async (req, res) => {
  try {
    const videoUrl = req.query.url;
    let format = req.query.format;
    if (!videoUrl) {
      return res.status(400).json({ success: false, message: "URL is required" });
    }

    let formatOption;
    
    // Branch for short videos: download progressive (video+audio)
    if (format === "short") {
      formatOption = 'best';
      console.log(`Downloading (short video): ${videoUrl} (Format: ${formatOption})`);
      res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
      const ytDlp = spawn('yt-dlp', [
        '-f', formatOption,
        '--remux-video', 'mp4',
        '-o', '-',
        videoUrl
      ]);
      ytDlp.stdout.pipe(res);
      ytDlp.stderr.on('data', (data) => {
        console.error('yt-dlp stderr:', data.toString());
      });
      ytDlp.on('close', (code) => {
        if (code !== 0) console.error(`yt-dlp exited with code ${code}`);
      });
      return;
    }
    
    // Branch for short videos: audio only download using a temporary file
    if (format === "shortAudio") {
      console.log(`Downloading audio only (short): ${videoUrl}`);
      // Generate a temporary file path for the MP3 output
      const tmpFilePath = path.join(
        os.tmpdir(),
        `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`
      );
      const ytDlp = spawn('yt-dlp', [
        '-f', 'bestaudio',
        '--extract-audio',
        '--audio-format', 'mp3',
        '-o', tmpFilePath,
        videoUrl
      ]);
      ytDlp.stderr.on('data', (data) => {
        console.error('yt-dlp stderr:', data.toString());
      });
      ytDlp.on('close', (code) => {
        if (code !== 0) {
          console.error(`yt-dlp exited with code ${code}`);
          return res.status(500).end("Error downloading audio");
        }
        res.setHeader('Content-Disposition', 'attachment; filename="audio.mp3"');
        const readStream = fs.createReadStream(tmpFilePath);
        readStream.pipe(res);
        readStream.on('close', () => {
          fs.unlink(tmpFilePath, (err) => {
            if (err) console.error("Error deleting temporary file:", err);
          });
        });
      });
      return;
    }
    
    // Existing branches for merged formats (for non-short videos)
    if (format === "merged1080") {
      formatOption = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]';
    } else if (format === "merged720") {
      formatOption = 'bestvideo[height<=720]+bestaudio/best[height<=720]';
    } else if (format === "merged480") {
      formatOption = 'bestvideo[height<=480]+bestaudio/best[height<=480]';
    } else {
      exec(`yt-dlp -J "${videoUrl}"`, (infoError, stdout, stderr) => {
        if (infoError) {
          console.error('Error fetching video info:', infoError.message);
          return res.status(500).json({ success: false, message: stderr || infoError.message });
        }
        try {
          const info = JSON.parse(stdout);
          if (!info.formats || info.formats.length === 0) {
            console.error("No formats found. Falling back to 'best'.");
            format = "best";
          }

          let selectedFormat;
          if (format && format !== "highest") {
            selectedFormat = info.formats.find(f => f.format_id === format);
            if (!selectedFormat) {
              console.error(`Format "${format}" not found. Falling back to 'best'.`);
              format = "best";
            }
          }

          if (format === "highest") {
            formatOption = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]';
          } else {
            format = format || "best";
            if (selectedFormat) {
              if (selectedFormat.acodec === 'none') {
                formatOption = `${format}+bestaudio`;
              } else if (selectedFormat.vcodec === 'none') {
                formatOption = `bestvideo+${format}`;
              } else {
                formatOption = format;
              }
            } else {
              formatOption = format;
            }
          }

          console.log(`Downloading: ${videoUrl} (Format: ${formatOption})`);
          res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
          const ytDlp = spawn('yt-dlp', [
            '-f', formatOption,
            '--remux-video', 'mp4',
            '-o', '-',
            videoUrl
          ]);
          ytDlp.stdout.pipe(res);
          ytDlp.stderr.on('data', (data) => {
            console.error('yt-dlp stderr:', data.toString());
          });
          ytDlp.on('close', (code) => {
            if (code !== 0) console.error(`yt-dlp exited with code ${code}`);
          });
        } catch (parseError) {
          console.error('Error parsing video info:', parseError);
          return res.status(500).json({ success: false, message: "Error parsing video information" });
        }
      });
      return;
    }
    
    // Fallback (if none of the above conditions match)
    console.log(`Downloading: ${videoUrl} (Preset Format: ${formatOption})`);
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    const ytDlp = spawn('yt-dlp', [
      '-f', formatOption,
      '--remux-video', 'mp4',
      '-o', '-',
      videoUrl
    ]);
    ytDlp.stdout.pipe(res);
    ytDlp.stderr.on('data', (data) => {
      console.error('yt-dlp stderr:', data.toString());
    });
    ytDlp.on('close', (code) => {
      if (code !== 0) console.error(`yt-dlp exited with code ${code}`);
    });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
