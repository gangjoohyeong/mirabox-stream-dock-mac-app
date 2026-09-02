import '../src/main/integrations/index.js'
import { KEYS, SOURCES, sourcesFor } from '../src/main/registry.js'
console.log('소스', SOURCES.size, ':', [...SOURCES.keys()].sort().join(', '))
console.log('키  ', KEYS.size, ':', [...KEYS.keys()].join(', '))
console.log('five, mail 에 필요한 소스:', [...sourcesFor(['five', 'mail'])].join(', '))
