# Ball announcements (Amharic)

The game plays one clip per ball, named by letter and number:

| Column | Files |
| --- | --- |
| B | `b1.mp3` … `b15.mp3` |
| I | `i16.mp3` … `i30.mp3` |
| N | `n31.mp3` … `n45.mp3` |
| G | `g46.mp3` … `g60.mp3` |
| O | `o61.mp3` … `o75.mp3` |

A missing file is skipped silently. Keep each clip under 2 seconds so it ends before the next ball.

## Make them with a male voice (Azure "Ameha")

From the `miniapp` folder, with a free Azure Speech key:

```powershell
$env:AZURE_SPEECH_KEY="your-key"; $env:AZURE_SPEECH_REGION="eastus"; npm run make:calls
```

`npm run make:calls -- --list` shows what is said for every ball (e.g. B5 → "ቢ፣ አምስት").

## Or record your own

Record each phrase (for example a real bingo caller saying "ቢ አምስት"), save it as MP3 with the file name
above, and put it in this folder. Short, loud, no silence at the start.
