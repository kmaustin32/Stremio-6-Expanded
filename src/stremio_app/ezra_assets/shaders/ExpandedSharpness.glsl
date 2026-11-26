// Sharpen-only FidelityFX CAS adaptation for the mpv output pipeline.
// https://github.com/GPUOpen-Effects/FidelityFX-CAS
//
// Copyright (c) 2017-2019 Advanced Micro Devices, Inc. All rights reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

//!PARAM amount
//!TYPE DYNAMIC float
//!MINIMUM 0
//!MAXIMUM 100
0

//!HOOK SCALED
//!BIND HOOKED
//!DESC Expanded FidelityFX CAS sharpening

vec4 hook()
{
    vec4 center = HOOKED_texOff(vec2(0.0));
    vec3 left = HOOKED_texOff(vec2(-1.0, 0.0)).rgb;
    vec3 right = HOOKED_texOff(vec2(1.0, 0.0)).rgb;
    vec3 above = HOOKED_texOff(vec2(0.0, -1.0)).rgb;
    vec3 below = HOOKED_texOff(vec2(0.0, 1.0)).rgb;
    vec3 low = min(center.rgb, min(min(left, right), min(above, below)));
    vec3 high = max(center.rgb, max(max(left, right), max(above, below)));
    // Give the filter less weight near black and white. Cap the slider at
    // the mild end of the standard CAS range for use with other upscalers.
    vec3 headroom = max(min(low, 1.0 - high), 0.0);
    vec3 weight = -0.00125 * amount * sqrt(headroom / max(high, 0.0001));
    vec3 sharpened = (center.rgb + weight * (left + right + above + below)) / (1.0 + 4.0 * weight);
    return vec4(sharpened, center.a);
}
