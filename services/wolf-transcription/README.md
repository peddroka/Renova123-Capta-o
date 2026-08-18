# THE WOLF local transcription

Local-only PCM16/24 kHz transcription service. The first start downloads the
Whisper model to the local Hugging Face cache; later starts do not need the API.

Run with `py -3.11 -m uvicorn app:app --host 127.0.0.1 --port 8765`.
