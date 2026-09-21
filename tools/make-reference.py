"""
Erzeugt unabhängige Referenzwerte für die Indikator-Tests mit pandas.

Eingabe:  packages/core/test/fixtures/yahoo-thyao-1d-2y.json  (aufgezeichnete Yahoo-Antwort)
Ausgabe:  packages/core/test/fixtures/thyao-1d.reference.json

Die TypeScript-Implementierung wird gegen diese Werte getestet. pandas liefert die Rechenengine
(ewm für EMA/Wilder, rolling für SMA, Populations-Std für Bollinger). Konvention wie bei TradingView:
EMA/Wilder-Reihen starten mit dem SMA der ersten n Werte (siehe `seeded`). So stimmen die Reihen ab dem
ersten Wert überein und nicht erst nach einer Einschwingphase.

Aufruf:  npm run reference   (benötigt Python mit pandas)
"""
import json
from pathlib import Path

import pandas as pd

FIXTURES = Path(__file__).resolve().parent.parent / "packages" / "core" / "test" / "fixtures"
SRC = FIXTURES / "yahoo-thyao-1d-2y.json"
OUT = FIXTURES / "thyao-1d.reference.json"


def series_to_list(s: pd.Series):
    return [None if pd.isna(v) else float(v) for v in s]


def seeded(x: pd.Series, first: int, n_seed: int, **ewm_kwargs) -> pd.Series:
    """
    Exponentielles Mittel, das bei Index `first + n_seed - 1` mit dem SMA der ersten `n_seed` gültigen
    Werte (ab Index `first`) startet. Alle Werte davor bleiben NaN.
    """
    start = first + n_seed - 1
    s = x.copy()
    s.iloc[:start] = float("nan")
    s.iloc[start] = x.iloc[first : first + n_seed].mean()
    return s.ewm(adjust=False, **ewm_kwargs).mean()


def main() -> None:
    raw = json.loads(SRC.read_text(encoding="utf-8"))["chart"]["result"][0]
    q = raw["indicators"]["quote"][0]
    df = pd.DataFrame(
        {
            "time": raw["timestamp"],
            "open": q["open"],
            "high": q["high"],
            "low": q["low"],
            "close": q["close"],
            "volume": q["volume"],
        }
    )
    df = df.dropna(subset=["open", "high", "low", "close"])
    df["volume"] = df["volume"].fillna(0)
    df = df.drop_duplicates("time", keep="last").sort_values("time").reset_index(drop=True)

    close = df["close"]
    out = {
        "candles": df.to_dict(orient="records"),
        "sma20": series_to_list(close.rolling(20).mean()),
        "sma50": series_to_list(close.rolling(50).mean()),
        "sma200": series_to_list(close.rolling(200).mean()),
        "ema20": series_to_list(seeded(close, 0, 20, span=20)),
        "ema50": series_to_list(seeded(close, 0, 50, span=50)),
        "ema200": series_to_list(seeded(close, 0, 200, span=200)),
    }

    # RSI: erste Änderung liegt bei Index 1, der erste RSI-Wert bei Index 14
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = seeded(gain, 1, 14, alpha=1 / 14)
    avg_loss = seeded(loss, 1, 14, alpha=1 / 14)
    out["rsi14"] = series_to_list(100 - 100 / (1 + avg_gain / avg_loss))

    macd = seeded(close, 0, 12, span=12) - seeded(close, 0, 26, span=26)
    signal = seeded(macd, 25, 9, span=9)
    out["macd"] = series_to_list(macd)
    out["macdSignal"] = series_to_list(signal)
    out["macdHist"] = series_to_list(macd - signal)

    mid = close.rolling(20).mean()
    std = close.rolling(20).std(ddof=0)
    out["bbMiddle"] = series_to_list(mid)
    out["bbUpper"] = series_to_list(mid + 2 * std)
    out["bbLower"] = series_to_list(mid - 2 * std)

    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1
    ).max(axis=1)
    tr.iloc[0] = df["high"].iloc[0] - df["low"].iloc[0]
    out["atr14"] = series_to_list(seeded(tr, 0, 14, alpha=1 / 14))

    OUT.write_text(json.dumps(out), encoding="utf-8")
    print(f"{len(df)} Kerzen -> {OUT}")


if __name__ == "__main__":
    main()
