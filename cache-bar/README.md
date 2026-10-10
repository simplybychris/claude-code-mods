# Cache Bar

Jedna kolorowa linia nad polem promptu:

- **cache**: ile zostało, zanim cache promptu wygaśnie (zielony, potem żółty, na końcu `cache cold`),
- **ctx**: ile tokenów zajmuje kontekst,
- **5h** i **week**: zużycie limitów planu i godzina resetu.

Liczby bierze z tego, co Claude Code już wie. Nie woła modelu i nie łączy się z siecią.

## Przycisk handoff

Gdy kontekst przekroczy połowę okna, po prawej pojawia się przycisk `handoff →` (skrót `h`, tylko między turami). Wysyła do Claude'a prośbę o użycie skilla **`session-handoff`**, który zapisuje podsumowanie sesji, żeby dało się ją wznowić w czystym oknie.

Ten skill nie jest częścią moda. Jeśli go nie masz, przycisk nic nie wysyła i pokazuje komunikat. Możesz dopisać własny skill o nazwie `session-handoff` w `~/.claude/skills/session-handoff/SKILL.md`.

## Ustawienia

W `/config`, wiersz **Prompt cache lifetime**: `auto` (domyślnie), `5m` albo `1h`. W trybie `auto` mod czyta `CLAUDE_CODE_PROMPT_CACHE_TTL`, potem `promptCacheTtl` z ustawień, a na końcu zakłada 1h przy subskrypcji w ramach limitu i 5 minut w pozostałych przypadkach.

Wymaga Claude Code 2.1.287+ w terminalu albo 2.1.286+ w aplikacji Desktop.
