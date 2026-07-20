use crate::ocr::preprocess::{is_red_pixel, is_black_pixel};

/// 通道A检测结果
pub struct ChannelAResult {
    pub triggered: bool,
    pub red_pixel_count: u32,
    pub black_pixel_count: u32,
}

/// 统计固定ROI内的红色像素数，支持上下限熔断
///
/// - `frame`: 全屏帧缓冲 (RGBA, 4 bytes/pixel)
/// - `frame_width`: 全屏宽度
/// - `roi`: (x, y, w, h) 裁剪区域
/// - `min_threshold`: 触发 OCR 的红色像素数下限
/// - `max_threshold`: 触发 OCR 的红色像素数上限（超过视为无效，跳过）
///
/// 一旦计数 >= max_threshold → 立即返回 triggered=false
pub fn detect_red_in_roi(
    frame: &[u8],
    frame_width: u32,
    roi: (u32, u32, u32, u32),
    min_threshold: u32,
    max_threshold: u32,
) -> ChannelAResult {
    let (rx, ry, rw, rh) = roi;
    let mut red_count = 0u32;
    let mut black_count = 0u32;

    for dy in 0..rh {
        let row_start = ((ry + dy) as usize) * (frame_width as usize) * 4 + (rx as usize) * 4;
        for dx in 0..rw {
            let idx = row_start + (dx as usize) * 4;
            let r = frame[idx];
            let g = frame[idx + 1];
            let b = frame[idx + 2];

            if is_red_pixel(r, g, b) {
                red_count += 1;
                // 达到上限 → 无效内容，提前返回
                if red_count >= max_threshold {
                    return ChannelAResult {
                        triggered: false,
                        red_pixel_count: red_count,
                        black_pixel_count: black_count,
                    };
                }
            }
            if is_black_pixel(r, g, b) {
                black_count += 1;
            }
        }
    }

    ChannelAResult {
        triggered: red_count >= min_threshold,
        red_pixel_count: red_count,
        black_pixel_count: black_count,
    }
}

/// 裁剪 ROI 区域像素到独立 buffer
pub fn crop_roi(
    frame: &[u8],
    frame_width: u32,
    roi: (u32, u32, u32, u32),
    dst: &mut [u8],
) {
    let (rx, ry, rw, rh) = roi;
    let dst_stride = (rw * 4) as usize;

    for dy in 0..rh {
        let src_start = ((ry + dy) as usize) * (frame_width as usize) * 4 + (rx as usize) * 4;
        let dst_start = (dy as usize) * dst_stride;
        let row_len = (rw as usize) * 4;
        dst[dst_start..dst_start + row_len]
            .copy_from_slice(&frame[src_start..src_start + row_len]);
    }
}
