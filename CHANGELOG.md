# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersje: [SemVer](https://semver.org/lang/pl/).

## [0.1.0] - 2026-10-10

Zadanie: pierwsze publiczne wydanie czterech modów · data: 2026-10-10 · impl: Claude Opus 5.5 · review: `claude plugin validate` i `claude plugin test` (Claude Code 2.1.295), audyt prywatności grepem · commity: `36593ec`..`7cf8494`

### Dodane

- Rec Mode (`/rec`): zamazuje na ekranie maile, klucze, adresy IP i nazwy użytkownika.
- Cache Bar: linia nad promptem z cache, kontekstem, limitami planu i przyciskiem handoff.
- Snake (`/snake`): wąż w panelu na czas pracy Claude'a.
- Panel agentów (`/ops`): subagenci i zadania w tle na żywo.
- README po polsku dla repo i każdego moda.

### Zmienione

- Rec Mode: na Windows rozpoznaje nazwę konta z `USERNAME` i `USERPROFILE`.
- Cache Bar: godzinę resetu limitu liczy przez `Intl` zamiast polecenia `date -r`, które działało tylko na macOS.
- Cache Bar: bez skilla `session-handoff` przycisk handoff pokazuje komunikat zamiast wysyłać prośbę.
- Panel agentów: dźwięk zakończenia gra przez API modów z własnego pliku `sounds/done.wav` zamiast `afplay` i dźwięku systemowego macOS.
- Panel agentów: skraca też ścieżki plików z Windows na osi czasu.
