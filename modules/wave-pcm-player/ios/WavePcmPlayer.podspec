Pod::Spec.new do |s|
  s.name           = 'WavePcmPlayer'
  s.version        = '1.0.0'
  s.summary        = 'Bounded foreground PCM playback for Wave'
  s.description    = 'Wave-owned raw Int16 PCM playback used by the gateway voice streaming feasibility proof.'
  s.author         = 'Renan Queiroz'
  s.homepage       = 'https://github.com/renanqts/wave-for-hermes'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
