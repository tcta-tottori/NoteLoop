package jp.tcta.noteloop;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaRecorder;
import android.util.Log;

import java.io.File;
import java.nio.ByteBuffer;

/**
 * マイクから PCM を読み、その場で AAC に圧縮して .m4a に書き出す録音エンジン。
 *
 * これまでは MediaRecorder に任せていたが、端末によっては
 * MediaRecorder.getMaxAmplitude() が常に 0 を返し、音量ゲージが作れなかった。
 * 自分で PCM を読めば音量は確実に分かるうえ、出来上がるファイルは
 * これまでと同じ（16kHz モノラル / AAC 32kbps の m4a）。
 *
 * 初期化に失敗した端末では呼び出し側が MediaRecorder に切り替えるので、
 * 「録音できない」ことにはならない。
 */
public class AudioRecorderEngine {

    private static final String TAG = "NoteLoopAudio";
    private static final int SAMPLE_RATE = 16000;
    private static final int BIT_RATE = 32000;
    private static final String MIME = "audio/mp4a-latm"; // AAC

    private AudioRecord record;
    private MediaCodec codec;
    private MediaMuxer muxer;
    private Thread thread;

    private volatile boolean running = false;
    private volatile String error = null;
    /** 前回 takePeak() を呼んでからの最大振幅（0..32767）。MediaRecorder と同じ意味。 */
    private volatile int peak = 0;
    private volatile boolean wroteAny = false;
    /** ライブ文字起こし用に PCM を溜めるか（Web 側が必要なときだけ ON） */
    private volatile boolean pcmTap = false;
    /** 溜めておく PCM。取りに来ない間は上限で捨てる（メモリを食わない） */
    private final java.io.ByteArrayOutputStream pcmBuf = new java.io.ByteArrayOutputStream();
    private static final int PCM_MAX = SAMPLE_RATE * 2 * 30; // 約30秒ぶん

    private int trackIndex = -1;
    private boolean muxerStarted = false;
    private long totalSamples = 0;
    private final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

    public String getError() { return error; }
    public boolean isRunning() { return running; }

    /** 前回呼んでからの最大振幅（0..32767）を返し、内部の記録をリセットする */
    public int takePeak() {
        int p = peak;
        peak = 0;
        return p;
    }

    /**
     * 録音を開始する。準備できなければ false（呼び出し側が別の方法に切り替える）。
     */
    public boolean start(String path) {
        try {
            File out = new File(path);
            File parent = out.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();

            int minBuf = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minBuf <= 0) { error = "この端末では録音バッファを用意できません"; return false; }
            // 0.5秒ぶん程度を確保しておくと、他の処理で少し詰まっても取りこぼさない
            int bufSize = Math.max(minBuf * 2, SAMPLE_RATE);

            record = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                error = "マイクを開けませんでした";
                release();
                return false;
            }

            MediaFormat fmt = MediaFormat.createAudioFormat(MIME, SAMPLE_RATE, 1);
            fmt.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            fmt.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE);
            fmt.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
            codec = MediaCodec.createEncoderByType(MIME);
            codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();

            muxer = new MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

            record.startRecording();
            if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                error = "録音を開始できませんでした（マイクが他のアプリに使われている可能性）";
                release();
                return false;
            }

            running = true;
            peak = 0;
            wroteAny = false;
            totalSamples = 0;
            thread = new Thread(this::loop, "noteloop-audio");
            thread.start();
            return true;
        } catch (Exception e) {
            error = String.valueOf(e.getMessage());
            Log.w(TAG, "AudioRecord で開始できませんでした", e);
            release();
            return false;
        }
    }

    /**
     * ライブ文字起こし用の PCM 取り出しを開始／終了する。
     * 録音そのものには影響しない（同じ読み取りを横取りするだけなので、
     * マイクを二重に開かずに済む＝録音中でも文字起こしができる）。
     */
    public void setPcmTap(boolean on) {
        synchronized (pcmBuf) { pcmBuf.reset(); }
        pcmTap = on;
    }

    /** 溜まった PCM（16kHz / 16bit / モノラル）を取り出して空にする。無ければ null。 */
    public byte[] takePcm() {
        synchronized (pcmBuf) {
            if (pcmBuf.size() == 0) return null;
            byte[] out = pcmBuf.toByteArray();
            pcmBuf.reset();
            return out;
        }
    }

    /** 録音を止め、ファイルを閉じる。書き出しが終わるまで待つ。 */
    public void stop() {
        running = false;
        Thread t = thread;
        if (t != null) {
            try { t.join(4000); } catch (InterruptedException ignored) {}
        }
        thread = null;
    }

    /** 音声を書き出せたか（0 バイトのファイルを掴ませないための確認用） */
    public boolean wroteAnything() { return wroteAny; }

    /* ===== ここから録音スレッド ===== */

    private void loop() {
        // 細かめ（約 32ms ぶん）に読む。音量の反応を早くするため、
        // ゲージの更新間隔より短くしておく。
        byte[] buf = new byte[1024];
        try {
            while (running) {
                int n = record.read(buf, 0, buf.length);
                if (n > 0) {
                    updatePeak(buf, n);
                    if (pcmTap) tapPcm(buf, n);
                    encode(buf, n);
                } else if (n < 0) {
                    error = "マイクの読み取りに失敗しました (" + n + ")";
                    break;
                }
            }
            finish();
        } catch (Exception e) {
            error = String.valueOf(e.getMessage());
            Log.e(TAG, "録音中に問題が起きました", e);
            try { finish(); } catch (Exception ignored) {}
        } finally {
            running = false;
            release();
        }
    }

    /** 読み込んだ PCM から最大振幅を拾う（16bit リトルエンディアン） */
    private void updatePeak(byte[] b, int len) {
        int p = 0;
        for (int i = 0; i + 1 < len; i += 2) {
            int v = (short) ((b[i] & 0xff) | (b[i + 1] << 8));
            int a = v < 0 ? -v : v;
            if (a > p) p = a;
        }
        if (p > peak) peak = p;
    }

    /** ライブ文字起こし用に PCM を溜める（上限を超えたら古い分は捨てる） */
    private void tapPcm(byte[] b, int len) {
        synchronized (pcmBuf) {
            if (pcmBuf.size() + len > PCM_MAX) pcmBuf.reset();
            pcmBuf.write(b, 0, len);
        }
    }

    /** PCM をエンコーダへ渡す（入り切らなければ分割して渡す） */
    private void encode(byte[] data, int len) {
        int off = 0;
        while (off < len) {
            int idx = codec.dequeueInputBuffer(10000);
            if (idx >= 0) {
                ByteBuffer ib = codec.getInputBuffer(idx);
                ib.clear();
                int n = Math.min(ib.remaining(), len - off);
                ib.put(data, off, n);
                codec.queueInputBuffer(idx, 0, n, ptsUs(), 0);
                totalSamples += n / 2;
                off += n;
            }
            drain(false);
        }
    }

    /** いま渡すデータの時刻（サンプル数から計算するのでズレない） */
    private long ptsUs() {
        return totalSamples * 1000000L / SAMPLE_RATE;
    }

    /** エンコード済みのデータを取り出してファイルへ書く */
    private void drain(boolean endOfStream) {
        int guard = 0;
        while (guard++ < 200) {
            int idx = codec.dequeueOutputBuffer(info, endOfStream ? 20000 : 0);
            if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream) return;   // まだ出来ていないだけ
                continue;                   // 終了時は出てくるまで待つ
            }
            if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (!muxerStarted) {
                    trackIndex = muxer.addTrack(codec.getOutputFormat());
                    muxer.start();
                    muxerStarted = true;
                }
                continue;
            }
            if (idx < 0) continue;

            ByteBuffer ob = codec.getOutputBuffer(idx);
            // 先頭に来る設定情報はファイルには書かない（addTrack 側で扱われる）
            if ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0;
            if (info.size > 0 && muxerStarted && ob != null) {
                ob.position(info.offset);
                ob.limit(info.offset + info.size);
                muxer.writeSampleData(trackIndex, ob, info);
                wroteAny = true;
            }
            codec.releaseOutputBuffer(idx, false);
            if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) return;
        }
    }

    /** 終わりの合図を送り、残りを書き切る */
    private void finish() {
        try {
            int idx = codec.dequeueInputBuffer(20000);
            if (idx >= 0) {
                codec.queueInputBuffer(idx, 0, 0, ptsUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM);
            }
            drain(true);
        } catch (Exception e) {
            Log.w(TAG, "終了処理に失敗しました", e);
        }
    }

    private void release() {
        try { if (record != null) { if (record.getState() == AudioRecord.STATE_INITIALIZED) record.stop(); record.release(); } }
        catch (Exception ignored) {}
        record = null;
        try { if (codec != null) { codec.stop(); codec.release(); } } catch (Exception ignored) {}
        codec = null;
        try { if (muxer != null) { if (muxerStarted) muxer.stop(); muxer.release(); } } catch (Exception ignored) {}
        muxer = null;
        muxerStarted = false;
        trackIndex = -1;
    }
}
