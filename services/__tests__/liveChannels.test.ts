import { parseM3U, Channel } from '../m3u';
import {
  groupLiveChannels,
  baseNameOf,
  isBackupChannel,
} from '../liveChannels';

const m3u = `#EXTM3U
#EXTINF:-1 tvg-logo="a" group-title="央视",CCTV-1
http://h/cctv1-primary.m3u8
#EXTINF:-1 group-title="央视",CCTV-1·备
http://h/cctv1-backup.m3u8
#EXTINF:-1 group-title="央视",CCTV-2
http://h/cctv2-primary.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视
http://h/hunan-primary.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视·备
http://h/hunan-backup-a.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视·备
http://h/hunan-backup-b.m3u8
#EXTINF:-1 group-title="央视",CCTV-1·备
http://h/cctv1-backup2.m3u8
`;

const channels: Channel[] = parseM3U(m3u);

describe('liveChannels 频道分组', () => {
  it('解析出全部原始条目', () => {
    expect(channels).toHaveLength(7);
  });

  it('基名去掉「·备」后缀', () => {
    expect(baseNameOf({ name: 'CCTV-1·备' } as Channel)).toBe('CCTV-1');
    expect(baseNameOf({ name: 'CCTV-1' } as Channel)).toBe('CCTV-1');
    expect(isBackupChannel({ name: 'CCTV-1·备' } as Channel)).toBe(true);
    expect(isBackupChannel({ name: 'CCTV-1' } as Channel)).toBe(false);
  });

  it('主备合并为一个频道，主源在首位', () => {
    const { groups } = groupLiveChannels(channels);
    const cctv1 = groups['央视'].find((e) => e.name === 'CCTV-1');
    expect(cctv1).toBeDefined();
    expect(cctv1!.sources).toHaveLength(3); // 1 主 + 2 备
    expect(cctv1!.sources[0].url).toBe('http://h/cctv1-primary.m3u8');
    expect(cctv1!.selectedSource).toBe(0);
  });

  it('默认全部使用主源', () => {
    const { groups } = groupLiveChannels(channels);
    for (const list of Object.values(groups)) {
      for (const entry of list) {
        expect(entry.selectedSource).toBe(0);
        expect(isBackupChannel(entry.sources[0])).toBe(false);
      }
    }
  });

  it('按分组归并，分组数正确', () => {
    const { groupNames, groups } = groupLiveChannels(channels);
    expect(groupNames).toEqual(['央视', '卫视']);
    expect(groups['央视'].map((e) => e.name)).toEqual(['CCTV-1', 'CCTV-2']);
    expect(groups['卫视'].map((e) => e.name)).toEqual(['湖南卫视']);
  });

  it('同一基名的备源按出现顺序保留', () => {
    const { groups } = groupLiveChannels(channels);
    const hunan = groups['卫视'].find((e) => e.name === '湖南卫视')!;
    expect(hunan.sources.map((s) => s.url)).toEqual([
      'http://h/hunan-primary.m3u8',
      'http://h/hunan-backup-a.m3u8',
      'http://h/hunan-backup-b.m3u8',
    ]);
  });

  it('只有备源时也能成组（主源回退为第一个备源）', () => {
    const onlyBackup = parseM3U(
      '#EXTM3U\n#EXTINF:-1 group-title="卫视",测试台·备\nhttp://h/only-backup.m3u8\n'
    );
    const { groups } = groupLiveChannels(onlyBackup);
    const entry = groups['卫视'][0];
    expect(entry.name).toBe('测试台');
    expect(entry.sources).toHaveLength(1);
  });
});
