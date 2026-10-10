# Panel agentów (mission-pane)

Boczny panel z subagentami i zadaniami w tle bieżącej sesji, na żywo: status, czas, liczba wywołań narzędzi, zajęty kontekst i ostatnia czynność. Gdy coś się skończy, pojawia się powiadomienie i krótki dźwięk.

## Jak używać

- `/ops` otwiera i zamyka panel.
- Klawisze od `1` do `9` otwierają szczegóły wiersza: u agenta jego zadanie, oś czasu wywołań narzędzi z wynikami, ostatnie wiadomości i raport, a u zadania w tle polecenie i końcówkę jego wyjścia.
- W szczegółach: `b` wraca do listy, `p` i `n` przechodzą do poprzedniego i następnego, `f` rozwija cały prompt.
- `c` chowa zakończone wiersze.

## Dobrze wiedzieć

- Mod niczego nie wysyła i nie woła modelu. Czyta tylko to, co Claude Code już ma.
- Dźwięk (`sounds/done.wav`) gra przez API modów. W terminalu na macOS działa od razu. W terminalu na Linuksie i Windows Claude Code nie ma odtwarzacza, więc zostaje samo powiadomienie.

Wymaga Claude Code 2.1.287+ w terminalu albo 2.1.286+ w aplikacji Desktop. Brak zależności.
