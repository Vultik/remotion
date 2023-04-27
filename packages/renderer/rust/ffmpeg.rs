use lazy_static::lazy_static;

use crate::errors::PossibleErrors;
use crate::opened_stream::calc_position;
use crate::opened_video::open_video;
use crate::opened_video::OpenedVideo;
use std::collections::HashMap;
use std::io::ErrorKind;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::RwLock;
extern crate ffmpeg_next as remotionffmpeg;

pub fn extract_frame(src: String, time: f64, transparent: bool) -> Result<Vec<u8>, PossibleErrors> {
    let manager = OpenedVideoManager::get_instance();
    let video_locked = manager.get_video(&src, transparent)?;
    let mut vid = video_locked.lock().unwrap();

    let position = calc_position(time, vid.time_base);
    let one_frame_after = calc_position(
        time + (1.0 / (vid.fps.numerator() as f64 / vid.fps.denominator() as f64)),
        vid.time_base,
    );
    let threshold = one_frame_after - position;
    let cache_item = vid
        .frame_cache
        .lock()
        .unwrap()
        .get_item_id(position, threshold);

    match cache_item {
        Ok(Some(item)) => {
            return Ok(vid
                .frame_cache
                .lock()
                .unwrap()
                .get_item_from_id(item)
                .unwrap()
                .unwrap());
        }
        Ok(None) => {}
        Err(err) => {
            return Err(err);
        }
    }

    let open_stream_count = vid.opened_streams.len();
    let mut suitable_open_stream: Option<usize> = None;
    for i in 0..open_stream_count {
        let stream = vid.opened_streams[i].lock().unwrap();
        if stream.reached_eof {
            continue;
        }
        if transparent != !stream.transparent {
            continue;
        }
        suitable_open_stream = Some(i);
        break;
    }
    let stream_index = match suitable_open_stream {
        Some(index) => Ok(index),
        None => vid.open_new_stream(transparent),
    };

    let mut first_opened_stream = vid
        .opened_streams
        .get(stream_index.unwrap())
        .unwrap()
        .lock()
        .unwrap();

    let frame_id = first_opened_stream.get_frame(time, &vid.frame_cache, position, vid.time_base);

    let from_cache = vid
        .frame_cache
        .lock()
        .unwrap()
        .get_item_from_id(frame_id.unwrap());

    match from_cache {
        Ok(Some(data)) => Ok(data),
        Ok(None) => Err(std::io::Error::new(
            ErrorKind::Other,
            "Frame evicted from cache",
        ))?,
        Err(err) => Err(err),
    }
}

pub struct OpenedVideoManager {
    videos: RwLock<HashMap<String, Arc<Mutex<OpenedVideo>>>>,
}

pub fn make_opened_stream_manager() -> OpenedVideoManager {
    remotionffmpeg::init().unwrap();
    OpenedVideoManager {
        videos: RwLock::new(HashMap::new()),
    }
}

impl OpenedVideoManager {
    pub fn get_instance() -> &'static OpenedVideoManager {
        lazy_static! {
            static ref INSTANCE: OpenedVideoManager = make_opened_stream_manager();
        }
        &INSTANCE
    }

    pub fn get_video(
        &self,
        src: &str,
        transparent: bool,
    ) -> Result<Arc<Mutex<OpenedVideo>>, PossibleErrors> {
        // Adding a block scope because of the RwLock,
        // preventing a deadlock
        {
            let videos_read = self.videos.try_read();
            if videos_read.is_err() {
                return Err(std::io::Error::new(ErrorKind::Other, "Deadlock").into());
            }
            let videos = videos_read.unwrap();
            if videos.contains_key(src) {
                return Ok(videos.get(src).unwrap().clone());
            }
        }

        let video = open_video(src, transparent)?;
        let videos_write = self.videos.write();

        videos_write
            .unwrap()
            .insert(src.to_string(), Arc::new(Mutex::new(video)));

        return Ok(self.videos.read().unwrap().get(src).unwrap().clone());
    }

    pub fn remove_video(&self, src: String) {
        let videos = self.videos.write();
        videos.unwrap().remove(&src);
    }
}
