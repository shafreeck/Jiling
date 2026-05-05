export class AudioStreamer {
  private context: AudioContext;
  private nextStartTime: number = 0;
  private isPlaying: boolean = false;
  public onAllEnded: (() => void) | null = null;

  constructor(context: AudioContext) {
    this.context = context;
  }

  async addAudioChunk(base64Data: string) {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // 假设输入是 24000Hz, Mono, 16-bit PCM
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 0x7FFF;
    }

    const buffer = this.context.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now + 0.05; // 增加一点缓冲
    }

    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    
    this.isPlaying = true;
    source.onended = () => {
      if (this.context.currentTime >= this.nextStartTime - 0.1) {
        this.isPlaying = false;
        this.onAllEnded?.();
      }
    };
  }

  stop() {
    this.nextStartTime = 0;
    this.isPlaying = false;
  }

  stopAll() {
    this.stop();
  }
}
