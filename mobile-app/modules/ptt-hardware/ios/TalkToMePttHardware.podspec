Pod::Spec.new do |s|
  s.name           = 'TalkToMePttHardware'
  s.version        = '0.1.0'
  s.summary        = 'Hardware keyboard input and PTT transport façade for TalkToMe'
  s.description    = 'iOS hardware keyboard press/release events and the Android PTT transport façade. BLE stays in TalkToMeBlePtt.'
  s.author         = 'TalkToMe Mobile'
  s.homepage       = 'https://github.com/LeeO86/talktome-mobile'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
