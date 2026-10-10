# Rec Mode

Tryb nagrywania. Gdy jest włączony, na ekranie zamazuje maile, klucze API, tokeny, hasła zapisane jako `password=...`, adresy IP i nazwy użytkownika. Najedź kursorem na zamazane miejsce, żeby je podejrzeć. Zmienia się tylko to, co widać: Claude dalej czyta wszystko normalnie, a zapis rozmowy zostaje bez zmian.

## Jak używać

- `/rec` włącza i wyłącza tryb (albo `/rec on`, `/rec off`).
- Pod polem promptu widać `● REC`, dopóki tryb jest włączony. Stan zostaje zapamiętany do następnej sesji.
- Własne słowa do zamazania (np. nick, nazwa klienta) dopiszesz w `/config`, w wierszu **Extra names to blur**, po przecinku.

## Dobrze wiedzieć

- Wykrywanie działa na wzorcach, więc coś może się prześlizgnąć. Przed publikacją nagrania i tak je obejrzyj.
- Odpowiedzi, prompty i wynik poleceń w powłoce są zamazane szarym paskiem. Wiersze, które rysuje sam Claude Code (wywołania narzędzi, spinner), dostają kropki `•••`.
- Nazwę konta bierze z `USER`/`HOME` (macOS, Linux) i `USERNAME`/`USERPROFILE` (Windows).

Wymaga Claude Code 2.1.287+ w terminalu albo 2.1.286+ w aplikacji Desktop. Brak zależności.
