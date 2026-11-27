"""Exercise bar detection and VO cropping with the bundled Windows mpv."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dll', required=True)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--script', type=Path)
    parser.add_argument('--hardware', action='store_true')
    args = parser.parse_args()
    assets = Path(__file__).resolve().parents[1] / 'src/stremio_app/ezra_assets'
    script = (args.script or assets / 'fork_bar_detection.lua').resolve()
    ffmpeg = str(Path(args.ffmpeg).resolve())
    with tempfile.TemporaryDirectory(prefix='stremio-bars-') as temp:
        output = Path(temp)
        for name, source in {
            'bars': 'color=c=0x80A0C0:s=320x180:r=24:d=20,pad=320:240:0:30:black',
            'pillar': 'color=c=0x80A0C0:s=240x240:r=24:d=20,pad=320:240:40:0:black',
            'full': 'color=c=0x80A0C0:s=320x240:r=24:d=20',
            'dark': 'color=c=black:s=320x240:r=24:d=20',
            'uneven': 'color=c=0x80A0C0:s=280x240:r=24:d=20,pad=320:240:40:0:black',
            'anamorphic': 'color=c=0x80A0C0:s=320x180:r=24:d=20,pad=320:240:0:30:black,setsar=8/9',
            'faint': 'color=c=0x80A0C0:s=320x180:r=24:d=20,pad=320:240:0:30:black,drawbox=x=0:y=28:w=320:h=2:color=0x080808:t=fill',
            'full-faint-edges': 'color=c=0x80A0C0:s=320x240:r=24:d=20,drawbox=x=0:y=0:w=320:h=2:color=0x080808:t=fill,drawbox=x=0:y=238:w=320:h=2:color=0x080808:t=fill',
            'soft': "color=s=320x240:r=4:d=20,geq=lum='128+18*sin(X*0.9)':cb=128:cr=128",
            'detail1080': "color=s=1920x1080:r=4:d=0.25,geq=lum='128+18*sin(X*0.45)':cb=128:cr=128,loop=loop=79:size=1:start=0",
        }.items():
            subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                            '-f', 'lavfi', '-i', source, '-c:v', 'libx264',
                            '-preset', 'ultrafast', str(output / f'{name}.mp4')],
                           check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        run(args, script, assets, ffmpeg, output)


def run(args, script, assets, ffmpeg, output):
    dll = c.CDLL(str(Path(args.dll).resolve()))
    dll.mpv_create.restype = c.c_void_p
    for name in ['mpv_initialize', 'mpv_terminate_destroy']:
        getattr(dll, name).argtypes = [c.c_void_p]
    for name in ['mpv_set_option_string', 'mpv_set_property_string']:
        getattr(dll, name).argtypes = [c.c_void_p, c.c_char_p, c.c_char_p]
    dll.mpv_get_property_string.argtypes = [c.c_void_p, c.c_char_p]
    dll.mpv_get_property_string.restype = c.c_void_p
    dll.mpv_free.argtypes = [c.c_void_p]
    dll.mpv_command.argtypes = [c.c_void_p, c.POINTER(c.c_char_p)]
    user = c.WinDLL('user32', use_last_error=True)
    user.CreateWindowExW.argtypes = [w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD,
                                   c.c_int, c.c_int, c.c_int, c.c_int,
                                   w.HWND, w.HMENU, w.HINSTANCE, c.c_void_p]
    user.CreateWindowExW.restype = w.HWND
    user.DestroyWindow.argtypes = [w.HWND]
    user.SetWindowPos.argtypes = [w.HWND, w.HWND, c.c_int, c.c_int, c.c_int, c.c_int, w.UINT]
    user.SetWindowPos.restype = w.BOOL
    user.PeekMessageW.argtypes = [c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT, w.UINT]
    user.DispatchMessageW.argtypes = [c.POINTER(w.MSG)]
    window = user.CreateWindowExW(0, 'STATIC', 'Black-bar detection test', 0x90000000,
                                  -32000, -32000, 800, 600, None, None, None, None)
    assert window, 'Could not create the native test window'
    player = dll.mpv_create()

    def prop(key):
        pointer = dll.mpv_get_property_string(player, key.encode())
        if not pointer:
            return ''
        try:
            return c.string_at(pointer).decode()
        finally:
            dll.mpv_free(pointer)

    def setprop(key, value):
        assert dll.mpv_set_property_string(player, key.encode(), str(value).encode()) >= 0, key

    def command(*values):
        array = (c.c_char_p * (len(values) + 1))(*[str(v).encode() for v in values], None)
        assert dll.mpv_command(player, array) >= 0, values

    def pump(seconds):
        end = time.monotonic() + seconds
        message = w.MSG()
        while time.monotonic() < end:
            while user.PeekMessageW(c.byref(message), None, 0, 0, 1):
                user.DispatchMessageW(c.byref(message))
            time.sleep(0.01)

    def state():
        return json.loads(prop('user-data/stremio-bar-detection') or '{}').get('state')

    def wait(predicate):
        end = time.monotonic() + 10
        while time.monotonic() < end:
            pump(0.05)
            if predicate():
                return
        raise AssertionError(f'Timeout: {prop("user-data/stremio-bar-detection")} vf={prop("vf")}')

    def load(name):
        # Some cases reload the same fixture. Wait for the old playback to end
        # so its matching path/time cannot satisfy the new-file condition.
        command('stop')
        wait(lambda: prop('idle-active') == 'yes' and state() == 'idle')
        command('loadfile', output / f'{name}.mp4')
        wait(lambda: prop('path').endswith(f'{name}.mp4') and float(prop('time-pos') or 0) > 0.2)
        assert state() == 'idle' and not prop('video-crop'), 'Each video must start uncropped'

    def detect():
        command('script-message-to', 'fork_bar_detection', 'detect')
        wait(lambda: state() != 'idle')
        wait(lambda: state() != 'detecting')
        assert 'stremio-fork-black-bars' not in prop('vf'), 'Remove only the temporary detector'

    def check_blurred_frame():
        picture = output / 'blur.png'
        command('show-text', '')
        setprop('osd-level', 0)
        setprop('border-background', 'blur')
        crop = prop('video-crop').replace('x', '+').split('+')
        if len(crop) == 4:
            width, height, x, y = map(int, crop)
            wait(lambda: prop('video-out-params/crop-x') == str(x) and
                 prop('video-out-params/crop-y') == str(y) and
                 prop('video-out-params/crop-w') == str(width) and
                 prop('video-out-params/crop-h') == str(height))
        pump(0.5)
        command('screenshot-to-file', picture, 'window')
        pixels = subprocess.check_output([ffmpeg, '-hide_banner', '-loglevel', 'error',
            '-i', str(picture), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
            creationflags=subprocess.CREATE_NO_WINDOW)
        # Check the interior across both picture and blur, including the join.
        for x in [100, 400, 700]:
            for y in range(15, 585):
                green = pixels[(y * 800 + x) * 3 + 1]
                if green < 130:
                    shutil.copyfile(picture, Path(args.dll).resolve().parent / 'detector-failure.png')
                    print({key: prop(key) for key in ['vf', 'video-crop', 'video-out-params', 'time-pos', 'pause']}, flush=True)
                assert green >= 130, f'A black bar or seam remains at ({x}, {y}): green={green}'

    try:
        settings = {'config': 'no', 'load-scripts': 'no', 'terminal': 'no', 'ao': 'null',
                    'vo': 'gpu-next', 'gpu-api': 'd3d11', 'wid': str(window),
                    'hwdec': 'auto' if args.hardware else 'no',
                    'screenshot-high-bit-depth': 'no', 'border-background': 'color',
                    'gpu-shader-cache-dir': str(output / 'shader-cache')}
        if not args.hardware:
            settings['d3d11-warp'] = 'yes'
        for key, value in settings.items():
            assert dll.mpv_set_option_string(player, key.encode(), value.encode()) >= 0, key
        assert dll.mpv_initialize(player) >= 0
        command('load-script', script)
        wait(lambda: state() == 'idle')
        load('bars')
        decoder = prop('hwdec-current')
        if args.hardware:
            assert decoder not in ['', 'no'], 'Hardware test requires an available hardware decoder'
        print(f'Testing {prop("mpv-version")} with decoder {decoder}', flush=True)
        detect()
        assert state() == 'locked' and prop('video-crop') == '320x178+0+31'
        assert prop('border-background') == 'color', 'Detection must leave blur under user control'
        assert prop('hwdec') == ('auto' if args.hardware else 'no')
        assert prop('hwdec-current') == decoder, 'Detection must retain the active decoder'
        check_blurred_frame()
        crop = prop('video-crop')
        setprop('glsl-shaders', str(assets / 'shaders/FSR.glsl'))
        assert prop('video-crop') == crop
        check_blurred_frame()
        setprop('glsl-shaders', '')
        setprop('hwdec', 'no')
        # Keep a confirmed crop across output resizing, including repeated
        # round trips. Derive the expected edges from the original rectangle.
        for width, height in [(640, 480), (160, 120), (320, 240), (640, 480), (320, 240)]:
            command('vf', 'add', f'@playback-resize:lavfi=[scale={width}:{height}:flags=neighbor]')
            top = math.ceil(31 * height / 240)
            bottom = math.floor(209 * height / 240)
            expected = f'{width}x{bottom - top}+0+{top}'
            wait(lambda: prop('video-out-params/w') == str(width) and
                 prop('video-crop') == expected and state() == 'locked')
            check_blurred_frame()
        assert prop('video-crop') == crop, 'Resize round trips must not accumulate crop rounding'
        command('vf', 'remove', '@playback-resize')
        command('script-message-to', 'fork_bar_detection', 'detect')
        wait(lambda: state() == 'idle')
        assert not prop('video-crop')
        print('PASS: crop/blur, FSR, resizing without drift, and one-press full-frame restoration')

        # Video-out dimensions can differ from decoder dimensions. Validate
        # actual rendered pixels so accepting a crop cannot hide a bad mapping.
        setprop('hwdec', 'no')
        for size in ['640:480', '160:120']:
            load('bars')
            command('vf', 'add', '@playback-resize:lavfi=[scale=' + size + ':flags=neighbor]')
            wait(lambda: prop('video-out-params/w') == size.split(':')[0])
            detect()
            assert state() == 'locked', prop('user-data/stremio-bar-detection')
            assert 'playback-resize' in prop('vf'), 'Preserve the existing resize'
            check_blurred_frame()
            command('script-message-to', 'fork_bar_detection', 'detect')
            wait(lambda: state() == 'idle')
            assert not prop('video-crop')
            command('vf', 'remove', '@playback-resize')
        print('PASS: crop and blur use the correct output coordinates after playback resizing')

        if args.hardware:
            # Exercise the app's GPU-processing path: its output remains on the
            # GPU even when the decoder is switched to a copy-back mode.
            setprop('hwdec', 'auto')
            for format_option in ['', ':format=x2bgr10']:
                load('bars')
                command('vf', 'add', '@gpu-processing:d3d11vpp=scale=2' + format_option)
                wait(lambda: prop('video-out-params/w') == '640' and
                     prop('video-out-params/pixelformat') == 'd3d11')
                detect()
                assert state() == 'locked', prop('user-data/stremio-bar-detection')
                assert 'gpu-processing' in prop('vf')
                assert prop('hwdec-current') == decoder
                check_blurred_frame()
                original = prop('video-crop')
                command('vf', 'remove', '@gpu-processing')
                wait(lambda: prop('video-out-params/w') == '320' and
                     prop('video-crop') == '320x178+0+31' and state() == 'locked')
                check_blurred_frame()
                command('vf', 'add', '@gpu-processing:d3d11vpp=scale=2' + format_option)
                wait(lambda: prop('video-out-params/w') == '640' and
                     prop('video-crop') == original and state() == 'locked')
                check_blurred_frame()
                command('script-message-to', 'fork_bar_detection', 'detect')
                wait(lambda: state() == 'idle')
                assert not prop('video-crop')
                command('vf', 'remove', '@gpu-processing')
            print('PASS: GPU on/off retains framing, 8/10-bit output, decoder and filter preservation')
            setprop('hwdec', 'no')

        for name in ['full', 'dark', 'uneven', 'full-faint-edges']:
            load(name)
            detect()
            assert state() in ['no-bars', 'uncertain'] and not prop('video-crop'), name
        load('full')
        command('vf', 'add', '@playback-resize:lavfi=[scale=640:480]')
        wait(lambda: prop('video-out-params/w') == '640')
        detect()
        assert state() == 'no-bars' and not prop('video-crop')
        command('vf', 'remove', '@playback-resize')
        load('pillar')
        detect()
        assert state() == 'locked' and prop('video-crop') == '238x240+41+0'
        check_blurred_frame()
        for name in ['anamorphic', 'faint']:
            load(name)
            detect()
            assert state() == 'locked', prop('user-data/stremio-bar-detection')
            check_blurred_frame()

        load('bars')
        command('script-message-to', 'fork_bar_detection', 'detect')
        wait(lambda: state() == 'detecting')
        setprop('pause', 'yes')
        wait(lambda: state() == 'cancelled')
        assert not prop('video-crop') and 'stremio-fork-black-bars' not in prop('vf')
        setprop('pause', 'no')
        load('bars')
        command('script-message-to', 'fork_bar_detection', 'detect')
        wait(lambda: state() == 'detecting')
        load('full')
        pump(0.5)
        assert state() == 'idle' and not prop('video-crop')
        print('PASS: no-bar/dark/asymmetric picture safety, pillarbox, anamorphic/seam cases, pause and new-file cancellation')

        # A smooth gray pattern has known edge contrast and no compression noise
        # from changing frames. Compare the actual picture at different amounts.
        load('soft')
        setprop('pause', 'yes')
        setprop('dither-depth', 'no')
        sharpener = assets / 'shaders/ExpandedSharpness.glsl'
        amount = 'ExpandedSharpness/amount'

        def edge_contrast(width=800, height=600):
            pump(0.2)
            picture = output / 'sharpen.png'
            command('screenshot-to-file', picture, 'window')
            pixels = subprocess.check_output([ffmpeg, '-hide_banner', '-loglevel', 'error',
                '-i', str(picture), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                creationflags=subprocess.CREATE_NO_WINDOW)
            middle = height // 2 * width + width // 2
            row = pixels[(middle - 80) * 3:(middle + 80) * 3:3]
            return sum(abs(left - right) for left, right in zip(row, row[1:]))

        def check_sharpening(width=800, height=600):
            upscale = prop('glsl-shaders')
            baseline = edge_contrast(width, height)
            command('change-list', 'glsl-shader-opts', 'add', amount + '=50')
            command('change-list', 'glsl-shaders', 'append', sharpener)
            mild = edge_contrast(width, height)
            command('change-list', 'glsl-shader-opts', 'add', amount + '=100')
            strong = edge_contrast(width, height)
            command('change-list', 'glsl-shader-opts', 'add', amount + '=150')
            enhanced = edge_contrast(width, height)
            assert enhanced > strong > mild > baseline, (width, upscale, baseline, mild, strong, enhanced)
            command('change-list', 'glsl-shaders', 'remove', sharpener)
            command('change-list', 'glsl-shader-opts', 'remove', amount)
            assert prop('glsl-shaders') == upscale
            assert edge_contrast(width, height) == baseline
            return baseline, mild, strong, enhanced

        for unscaled, upscale in [('yes', ''), ('no', ''), ('no', str(assets / 'shaders/FSR.glsl'))]:
            setprop('video-unscaled', unscaled)
            setprop('glsl-shaders', upscale)
            check_sharpening()
        setprop('glsl-shaders', '')
        setprop('pause', 'no')
        assert user.SetWindowPos(window, None, -32000, -32000, 2560, 1440, 0x14)
        load('detail1080')
        setprop('pause', 'yes')
        wait(lambda: prop('osd-width') == '2560' and prop('osd-height') == '1440')
        baseline, mild, strong, enhanced = check_sharpening(2560, 1440)
        assert mild > baseline * 1.025 and strong > baseline * 1.10, (baseline, mild, strong)
        assert enhanced > strong * 1.025, (strong, enhanced)
        setprop('pause', 'no')
        setprop('dither-depth', 'auto')
        print(f'PASS: live sharpening at 1:1, with FSR, and at 1440p (contrast {baseline}, {mild}, {strong}, {enhanced})')
    finally:
        dll.mpv_terminate_destroy(player)
        user.DestroyWindow(window)


if __name__ == '__main__':
    main()
