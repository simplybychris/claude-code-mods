# Mody do Claude Code

Cztery mody (Claude Mods) do Claude Code w terminalu i w aplikacji Desktop.

| Mod | Co robi |
| :- | :- |
| [Rec Mode](rec-mode/) | Tryb nagrywania. Zamazuje na ekranie maile, klucze, adresy IP i nazwy użytkownika, a Claude dalej widzi wszystko normalnie. `/rec` |
| [Cache Bar](cache-bar/) | Linia nad promptem: ile zostało do wygaśnięcia cache, ile zajmuje kontekst i jak wyglądają limity planu. Od połowy kontekstu pokazuje przycisk handoff. |
| [Snake](snake/) | Wąż w panelu obok rozmowy, gdy czekasz na Claude'a. `/snake` |
| [Panel agentów](mission-pane/) | Panel z subagentami i zadaniami w tle, na żywo, z powiadomieniem, gdy coś się skończy. `/ops` |

## Wymagania

Claude Code **2.1.287** lub nowszy w terminalu (`claude --version`) albo **2.1.286** lub nowszy w aplikacji Desktop (w zakładce Code wpisz `/status`). Sprawdzone na 2.1.295.

## Instalacja

Każdy mod to osobny folder z plikiem `.claude-plugin/plugin.json`. Claude Code wczytuje go w każdej sesji, jeśli leży w folderze `skills` w katalogu `.claude`.

**macOS i Linux**

1. Pobierz ZIP moda (zakładka Releases) i rozpakuj go do `~/.claude/skills/`. Wyjdzie np. `~/.claude/skills/rec-mode/`.
2. W otwartej sesji Claude Code wpisz `/reload-plugins` albo uruchom Claude Code od nowa.
3. Wpisz `/plugin`. Pod zakładkami zobaczysz linię `… mods active · rec-mode`.

**Windows**

1. Rozpakuj ZIP do `%USERPROFILE%\.claude\skills\`. Wyjdzie np. `C:\Users\<ty>\.claude\skills\rec-mode\`.
2. `/reload-plugins` w otwartej sesji albo restart Claude Code.
3. `/plugin`, żeby sprawdzić, czy mod się wczytał.

W aplikacji Desktop na Windows mody działają w zwykłych sesjach, ale nie w sesjach WSL.

Żeby wypróbować mod tylko w jednej sesji, bez kopiowania: `claude --plugin-dir ./rec-mode` (może to być też sam plik ZIP).

Wolisz trzymać mody w innym miejscu, np. `~/.claude/mods/`? Claude Code nie przeszukuje go sam. Dopisz pełne ścieżki do `CLAUDE_CODE_PLUGIN_DIRS` w sekcji `env` pliku `~/.claude/settings.json`, rozdzielone `:` (macOS, Linux) albo `;` (Windows).

Mod wyłączysz w `/plugin` (zakładka Installed) albo usuwając jego folder.

## Cache Bar i przycisk handoff

Przycisk `handoff →` prosi Claude'a o użycie skilla `session-handoff`, którego nie ma w tej paczce. Bez niego przycisk tylko pokazuje komunikat. Szczegóły w [README Cache Bar](cache-bar/).

## Bezpieczeństwo

Mod działa z Twoimi uprawnieniami. Zanim zainstalujesz cudzy, sprawdź, co robi: `claude plugin validate <folder-moda>` wypisze zdarzenia, na które reaguje, i wywołania, których używa.
