import soundfile as sf
import librosa
import numpy as np
from scipy import signal

def process_voice():
    input_path = "frontend/public/aippon_voice.orig.wav"
    output_path = "frontend/public/aippon_voice.wav"
    
    # 1. 読み込み
    y, sr = sf.read(input_path)
    if y.ndim > 1:
        y = y.mean(axis=1) # モノラル化
    
    # 2. タイムストレッチ (2.0倍速、ピッチ保持)
    # librosa.effects.time_stretch は高品質な位相ボコーダーでピッチを変えずに長さを半分にする
    y_fast = librosa.effects.time_stretch(y, rate=2.0)
    
    # 3. 低音ブースト (260Hz Low-shelf 相当, +6dB)
    f0 = 260.0
    gain_db = 6.0
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / sr
    alpha = np.sin(w0) / 2 * np.sqrt(2) # Q = 1/sqrt(2)
    
    b0 = A * ((A + 1) - (A - 1) * np.cos(w0) + 2 * np.sqrt(A) * alpha)
    b1 = 2 * A * ((A - 1) - (A + 1) * np.cos(w0))
    b2 = A * ((A + 1) - (A - 1) * np.cos(w0) - 2 * np.sqrt(A) * alpha)
    a0 = (A + 1) + (A - 1) * np.cos(w0) + 2 * np.sqrt(A) * alpha
    a1 = -2 * ((A - 1) + (A + 1) * np.cos(w0))
    a2 = (A + 1) + (A - 1) * np.cos(w0) - 2 * np.sqrt(A) * alpha
    
    b_shelf = np.array([b0, b1, b2]) / a0
    a_shelf = np.array([a0, a1, a2]) / a0
    
    y_boosted = signal.lfilter(b_shelf, a_shelf, y_fast)
    
    # 4. 高域カット (3200Hz Peaking cut -3.5dB 相当)
    f_cut = 3200.0
    gain_cut_db = -3.5
    A_cut = 10 ** (gain_cut_db / 40)
    w_cut = 2 * np.pi * f_cut / sr
    Q_cut = 1.0
    alpha_cut = np.sin(w_cut) / (2 * Q_cut)
    
    b0_cut = 1 + alpha_cut * A_cut
    b1_cut = -2 * np.cos(w_cut)
    b2_cut = 1 - alpha_cut * A_cut
    a0_cut = 1 + alpha_cut / A_cut
    a1_cut = -2 * np.cos(w_cut)
    a2_cut = 1 - alpha_cut / A_cut
    
    b_peaking = np.array([b0_cut, b1_cut, b2_cut]) / a0_cut
    a_peaking = np.array([a0_cut, a1_cut, a2_cut]) / a0_cut
    
    y_eq = signal.lfilter(b_peaking, a_peaking, y_boosted)
    
    # 5. アリーナ風ディレイ（空間エコー）
    # App.tsx の設定: delay 0.16s, feedback 0.3, filter lowpass 1800Hz, mix 0.28
    delay_samples = int(0.16 * sr)
    # ディレイ用のローパスフィルタ (1800Hz Butterworth 2次)
    b_lp, a_lp = signal.butter(2, 1800.0 / (sr / 2), btype='low')
    
    # エコーの反響音を足し合わせる
    extra_tail = int(0.8 * sr)
    y_out = np.pad(y_eq, (0, extra_tail), mode='constant')
    
    # フィードバックループのシミュレーション
    delay_buffer = np.zeros(len(y_out))
    current_echo = y_eq.copy()
    current_gain = 0.28
    
    for _ in range(3): # 3タップ程度のエコー
        # ローパスを通過
        filtered_echo = signal.lfilter(b_lp, a_lp, current_echo)
        start_idx = delay_samples * (_ + 1)
        end_idx = start_idx + len(filtered_echo)
        if start_idx < len(y_out):
            valid_len = min(len(filtered_echo), len(y_out) - start_idx)
            y_out[start_idx:start_idx + valid_len] += filtered_echo[:valid_len] * current_gain
        current_echo = filtered_echo
        current_gain *= 0.3 # feedback
    
    # 6. 音割れ防止のためのノーマライズ（ピークを-0.5dBに揃える）
    peak = np.max(np.abs(y_out))
    if peak > 0:
        target_peak = 10 ** (-0.5 / 20)
        y_out = y_out * (target_peak / peak)
    
    # 7. 保存 (16-bit PCM WAV)
    sf.write(output_path, y_out, sr, subtype="PCM_16")
    print(f"Successfully processed and saved to {output_path}")
    print(f"Original duration: {len(y)/sr:.2f}s -> Processed duration: {len(y_out)/sr:.2f}s")

if __name__ == "__main__":
    process_voice()
