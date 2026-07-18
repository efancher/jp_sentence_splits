# Japanese text-to-speech — manual iPhone/iPad test checklist

Automated tests cover voice selection and playback-state logic with a mocked
Web Speech API, but desktop testing is not sufficient. Verify the deployed
GitHub Pages build in Safari on an actual Apple mobile device.

## Checklist

1. Open the deployed site in Safari.
2. Open a sentence in Analyze and tap the sentence 🔊 button.
3. Confirm Japanese pronunciation (not English-style reading of romaji).
4. Tap 🔊 on several different sentences and chunks rapidly.
5. Confirm old utterances do not accumulate in a queue — each tap replaces
   the previous playback.
6. Stop speech while it is active (tap the active 🔊 or **Stop audio**).
7. Play an individual chunk and confirm only that chunk's text is spoken.
8. Change the speaking rate in **Settings → Text-to-speech** and re-test.
9. Change the selected Japanese voice, when multiple voices are listed.
10. Reload the page and confirm the voice and rate settings persist.
11. Add the site to the Home Screen and repeat playback testing there.
12. Lock and unlock the device during and after playback.
13. Switch to another app and return; confirm the UI is not stuck in a
    "Speaking…" state.
14. Test with the ring/silent switch on silent and with media volume changed.
15. Confirm buttons for an empty chunk are disabled and nothing plays.
16. Test a long Japanese sentence end to end.
17. Test text containing kanji, kana, numbers, Latin letters, and punctuation.
18. Test **Play by chunks**: chunks play in order, the current chunk is
    highlighted, and Stop works mid-sequence.
19. Navigate between sentences and books during playback; confirm playback
    stops and the active state resets.
20. Confirm the app remains fully usable if no voice list is returned
    (voice selector shows "Automatic"; playback still works via `ja-JP`).

## Known platform notes

- iOS exposes only a subset of installed system voices to web apps; Siri
  voices are generally not available to JavaScript.
- `speechSynthesis.getVoices()` may return an empty list until the
  `voiceschanged` event fires; the app handles this and falls back to
  `utterance.lang = "ja-JP"`.
- Offline playback depends on the selected voice being installed on the
  device. Voices marked "(on device)" in Settings are preferred.
