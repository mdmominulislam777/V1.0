#!/bin/bash
set -e

OUT="public/highfy-screen-recording.mp4"
DIST_OUT="dist/highfy-screen-recording.mp4"

echo "Rendering HighFy TV Screen Recording (Escaped colons)..."

ffmpeg -y -f lavfi -i color=c=0x0b0f19:s=720x1280:d=4 -vf "
drawbox=x=0:y=0:w=720:h=70:color=0x131a2a@1:t=fill,
drawtext=text='HIGHFY TV':fontsize=28:fontcolor=0x38bdf8:x=40:y=20,
drawtext=text='LIVE STREAMING':fontsize=16:fontcolor=0x94a3b8:x=190:y=28,
drawbox=x=30:y=100:w=660:h=380:color=0x1e293b@1:t=fill,
drawbox=x=50:y=120:w=120:h=35:color=0xdc2626@1:t=fill,
drawtext=text='LIVE HD':fontsize=18:fontcolor=white:x=70:y=128,
drawtext=text='Willow HD - Server 1 (1080p FHD)':fontsize=20:fontcolor=white:x=200:y=128,
drawtext=text='India vs New Zealand (Test Match - Day 2)':fontsize=24:fontcolor=white:x=60:y=200,
drawtext=text='India 285/4 (78.2 ov) vs NZ 259':fontsize=22:fontcolor=0xfacc15:x=60:y=250,
drawbox=x=50:y=430:w=620:h=8:color=0x334155@1:t=fill,
drawbox=x=50:y=430:w=380:h=8:color=0xef4444@1:t=fill,
drawtext=text='01-14-28 / LIVE':fontsize=16:fontcolor=0x94a3b8:x=50:y=450,
drawbox=x=30:y=520:w=660:h=180:color=0x131a2a@1:t=fill,
drawtext=text='Match Details & Broadcaster':fontsize=22:fontcolor=0x38bdf8:x=50:y=545,
drawtext=text='Channel- Willow HD (Authorized Source)':fontsize=18:fontcolor=white:x=50:y=590,
drawtext=text='Playback Status- ACTIVE STREAMING':fontsize=18:fontcolor=0x22c55e:x=50:y=630,
drawbox=x=0:y=1200:w=720:h=80:color=0x0f172a@1:t=fill,
drawtext=text='Live Event':fontsize=18:fontcolor=0x38bdf8:x=80:y=1230,
drawtext=text='Category':fontsize=18:fontcolor=0x64748b:x=320:y=1230,
drawtext=text='Highlights':fontsize=18:fontcolor=0x64748b:x=540:y=1230
" -c:v libx264 -pix_fmt yuv420p -r 24 -y /tmp/scene1.mp4

ffmpeg -y -f lavfi -i color=c=0x0b0f19:s=720x1280:d=4 -vf "
drawbox=x=0:y=0:w=720:h=70:color=0x131a2a@1:t=fill,
drawtext=text='HIGHFY TV':fontsize=28:fontcolor=0x38bdf8:x=40:y=20,
drawtext=text='SEARCH':fontsize=16:fontcolor=0x94a3b8:x=190:y=28,
drawbox=x=30:y=100:w=660:h=60:color=0x1e293b@1:t=fill,
drawtext=text='Arsenal':fontsize=26:fontcolor=white:x=60:y=115,
drawtext=text='[Clear X]':fontsize=18:fontcolor=0x94a3b8:x=580:y=120,
drawtext=text='Search Results (1 Match Found)':fontsize=20:fontcolor=0x38bdf8:x=40:y=190,
drawbox=x=30:y=230:w=660:h=200:color=0x131a2a@1:t=fill,
drawbox=x=50:y=250:w=120:h=30:color=0x334155@1:t=fill,
drawtext=text='FINISHED':fontsize=16:fontcolor=0x94a3b8:x=65:y=256,
drawtext=text='Arsenal vs Leeds United':fontsize=26:fontcolor=white:x=50:y=300,
drawtext=text='Tournament- English Premier League':fontsize=18:fontcolor=0x94a3b8:x=50:y=345,
drawtext=text='Result- Arsenal Won (3 - 1)':fontsize=18:fontcolor=0x22c55e:x=50:y=380,
drawbox=x=0:y=1200:w=720:h=80:color=0x0f172a@1:t=fill,
drawtext=text='Live Event':fontsize=18:fontcolor=0x64748b:x=80:y=1230,
drawtext=text='Category':fontsize=18:fontcolor=0x64748b:x=320:y=1230,
drawtext=text='Highlights':fontsize=18:fontcolor=0x64748b:x=540:y=1230
" -c:v libx264 -pix_fmt yuv420p -r 24 -y /tmp/scene2.mp4

ffmpeg -y -f lavfi -i color=c=0x0b0f19:s=720x1280:d=4 -vf "
drawbox=x=0:y=0:w=720:h=70:color=0x131a2a@1:t=fill,
drawtext=text='HIGHFY TV':fontsize=28:fontcolor=0x38bdf8:x=40:y=20,
drawtext=text='FAVORITES':fontsize=16:fontcolor=0x94a3b8:x=190:y=28,
drawbox=x=30:y=100:w=660:h=60:color=0x064e3b@1:t=fill,
drawtext=text='Saved to Favorites! (Gold Star Active)':fontsize=22:fontcolor=0x34d399:x=60:y=116,
drawtext=text='Saved Matches & Channels (1 Item)':fontsize=20:fontcolor=0x38bdf8:x=40:y=190,
drawbox=x=30:y=230:w=660:h=220:color=0x131a2a@1:t=fill,
drawtext=text='[ FAVORITED ]':fontsize=20:fontcolor=0xf59e0b:x=500:y=250,
drawtext=text='India Women vs Zimbabwe Women':fontsize=24:fontcolor=white:x=50:y=285,
drawtext=text='Series- ODI Tri-Series 2026':fontsize=18:fontcolor=0x94a3b8:x=50:y=330,
drawtext=text='Channel- Willow HD':fontsize=18:fontcolor=0x38bdf8:x=50:y=370,
drawtext=text='Status- Saved in LocalStorage':fontsize=16:fontcolor=0x22c55e:x=50:y=405,
drawbox=x=0:y=1200:w=720:h=80:color=0x0f172a@1:t=fill,
drawtext=text='Live Event':fontsize=18:fontcolor=0x64748b:x=80:y=1230,
drawtext=text='Category':fontsize=18:fontcolor=0x64748b:x=320:y=1230,
drawtext=text='Highlights':fontsize=18:fontcolor=0x64748b:x=540:y=1230
" -c:v libx264 -pix_fmt yuv420p -r 24 -y /tmp/scene3.mp4

ffmpeg -y -f lavfi -i color=c=0x0b0f19:s=720x1280:d=4 -vf "
drawbox=x=0:y=0:w=720:h=70:color=0x131a2a@1:t=fill,
drawtext=text='HIGHFY TV':fontsize=28:fontcolor=0x38bdf8:x=40:y=20,
drawtext=text='HIGHLIGHTS & REPLAYS':fontsize=16:fontcolor=0x94a3b8:x=190:y=28,
drawtext=text='Featured Match Highlights':fontsize=22:fontcolor=white:x=40:y=105,
drawbox=x=30:y=140:w=660:h=220:color=0x131a2a@1:t=fill,
drawbox=x=50:y=160:w=620:h=120:color=0x1e293b@1:t=fill,
drawtext=text='[ PLAY REPLAY ]':fontsize=22:fontcolor=0x38bdf8:x=260:y=205,
drawtext=text='Premier League- Arsenal vs Leeds Highlights':fontsize=20:fontcolor=white:x=50:y=295,
drawtext=text='Duration- 12-45 | 1080p':fontsize=16:fontcolor=0x94a3b8:x=50:y=325,
drawbox=x=30:y=390:w=660:h=220:color=0x131a2a@1:t=fill,
drawbox=x=50:y=410:w=620:h=120:color=0x1e293b@1:t=fill,
drawtext=text='[ PLAY REPLAY ]':fontsize=22:fontcolor=0x38bdf8:x=260:y=455,
drawtext=text='ICC Classics- India vs Australia Test Replay':fontsize=20:fontcolor=white:x=50:y=545,
drawtext=text='Duration- 24-10 | 1080p':fontsize=16:fontcolor=0x94a3b8:x=50:y=575,
drawbox=x=0:y=1200:w=720:h=80:color=0x0f172a@1:t=fill,
drawtext=text='Live Event':fontsize=18:fontcolor=0x64748b:x=80:y=1230,
drawtext=text='Category':fontsize=18:fontcolor=0x64748b:x=320:y=1230,
drawbox=x=500:y=1210:w=160:h=60:color=0x1e293b@1:t=fill,
drawtext=text='Highlights':fontsize=18:fontcolor=0x38bdf8:x=540:y=1230
" -c:v libx264 -pix_fmt yuv420p -r 24 -y /tmp/scene4.mp4

# Concat
echo "file '/tmp/scene1.mp4'" > /tmp/list.txt
echo "file '/tmp/scene2.mp4'" >> /tmp/list.txt
echo "file '/tmp/scene3.mp4'" >> /tmp/list.txt
echo "file '/tmp/scene4.mp4'" >> /tmp/list.txt

ffmpeg -y -f concat -safe 0 -i /tmp/list.txt -c copy "$OUT"
cp "$OUT" "$DIST_OUT"

echo "Screen recording video successfully created at $OUT ($DIST_OUT)!"
ls -lh "$OUT"
