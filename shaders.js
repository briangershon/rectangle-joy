(() => {
  // WebGL Shader System for Frame and Glass Effects

  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;

    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    uniform sampler2D u_texture;
    uniform vec2 u_resolution;
    uniform float u_frameWidth;
    uniform float u_glassIntensity;
    uniform float u_reflectionIntensity;
    uniform vec2 u_mousePosition;

    varying vec2 v_texCoord;

    // Procedural noise function for surface variation
    float noise(vec2 uv) {
      return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    }

    // Smooth noise
    float smoothNoise(vec2 uv) {
      vec2 i = floor(uv);
      vec2 f = fract(uv);

      float a = noise(i);
      float b = noise(i + vec2(1.0, 0.0));
      float c = noise(i + vec2(0.0, 1.0));
      float d = noise(i + vec2(1.0, 1.0));

      vec2 u = f * f * (3.0 - 2.0 * f);

      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }

    // Frame effect function with reflections
    vec4 applyFrame(vec2 uv, vec4 originalColor) {
      vec2 center = vec2(0.5, 0.5);
      vec2 dist = abs(uv - center);

      // Frame thickness (0.0 to 0.5)
      float frameThickness = u_frameWidth;

      // Check if we're in the frame area
      bool inFrame = (dist.x > 0.5 - frameThickness || dist.y > 0.5 - frameThickness);

      if (inFrame) {
        // Frame gradient effect
        float edgeDist = min(
          min(uv.x, 1.0 - uv.x),
          min(uv.y, 1.0 - uv.y)
        );

        // Normalize edge distance for frame thickness
        float normalizedDist = edgeDist / frameThickness;

        // Create beveled frame effect with stronger material definition
        float bevel = smoothstep(0.0, 1.0, normalizedDist);
        vec3 baseFrameColor = mix(
          vec3(0.3, 0.25, 0.18),   // Rich dark wood brown
          vec3(0.5, 0.45, 0.35),   // Warm light wood brown
          bevel
        );

        // Enhanced wood grain effect for solid appearance
        float surfaceNoise = smoothNoise(uv * 60.0 + vec2(0.0, uv.x * 25.0));
        float grainPattern = smoothNoise(uv * vec2(220.0, 25.0));
        float fineGrain = smoothNoise(uv * 400.0) * 0.03; // Fine wood texture

        // Combine grain patterns for realistic wood appearance
        float woodGrain = mix(surfaceNoise, grainPattern, 0.4) * 0.12 + fineGrain;

        // Add wood color variation
        vec3 grainColorVariation = vec3(woodGrain * 0.8, woodGrain * 0.6, woodGrain * 0.4);
        vec3 frameColor = baseFrameColor + grainColorVariation;

        // Calculate dynamic viewing direction based on mouse position
        vec2 mouseOffset = u_mousePosition - vec2(0.5, 0.5); // Center mouse position
        vec2 viewDirection = normalize(vec2(mouseOffset.x, -mouseOffset.y)); // Flip Y for screen coords

        // Calculate surface normal relative to frame edge
        vec2 surfaceToCenter = normalize(uv - center);

        // Dynamic viewing angle for Fresnel effect (solid material behavior)
        float viewAngle = dot(surfaceToCenter, viewDirection);
        // Solid material Fresnel: more reflection at glancing angles, but not transparency
        float fresnel = pow(1.0 - abs(viewAngle), 2.5) * 0.8; // Reduced intensity for solid material

        // Mouse-responsive environment reflection for solid surface
        float mouseInfluence = length(mouseOffset) * 1.5; // More subtle for solid material
        vec2 reflectionOffset = mouseOffset * 0.3; // Reduced offset for surface reflection

        // Environment reflection patterns that suggest room lighting reflecting off wood surface
        float envPattern1 = sin((uv.x + reflectionOffset.x) * 5.0 + (uv.y + reflectionOffset.y) * 2.5) * 0.5 + 0.5;
        float envPattern2 = sin((uv.y - reflectionOffset.x) * 3.0 + (uv.x + reflectionOffset.y) * 1.5) * 0.5 + 0.5;

        // Blend environment patterns more subtly for solid material
        float environmentReflection = mix(envPattern1, envPattern2, 0.6 + mouseInfluence * 0.15) * 0.2;

        // Dynamic specular highlights based on mouse position
        vec2 lightDir = normalize(vec2(1.0 + mouseOffset.x * 0.5, 1.0 + mouseOffset.y * 0.5));
        vec2 surfaceNormal = normalize(vec2(
          smoothNoise(uv * 100.0 + vec2(1.0, 0.0)) - smoothNoise(uv * 100.0 - vec2(1.0, 0.0)),
          smoothNoise(uv * 100.0 + vec2(0.0, 1.0)) - smoothNoise(uv * 100.0 - vec2(0.0, 1.0))
        )) * 0.3 + vec2(mouseOffset.x, -mouseOffset.y) * 0.2; // Add mouse influence to surface normal

        vec2 reflectDir = reflect(-lightDir, surfaceNormal);
        vec2 eyeDir = normalize(vec2(mouseOffset.x, mouseOffset.y));
        float specular = pow(max(dot(reflectDir, eyeDir), 0.0), 12.0 + mouseInfluence * 8.0);

        // Combine reflection effects for solid material (wood/metal surface reflection)
        float totalReflection = (fresnel * environmentReflection + specular * 0.8) * u_reflectionIntensity;

        // Solid material reflection - reflects off surface, not through material
        vec3 materialReflectionColor = vec3(0.95, 0.98, 1.0); // Subtle warm reflection tint

        // Surface-only reflection: add reflections to the material color rather than mixing
        // This creates the appearance of light bouncing off a solid surface
        vec3 surfaceReflection = materialReflectionColor * totalReflection * 0.25;
        frameColor = frameColor + surfaceReflection;

        // Ensure frame remains opaque and solid-looking
        frameColor = clamp(frameColor, 0.0, 1.0);

        // Add inner shadow for depth and beveled appearance
        float innerShadow = smoothstep(0.8, 1.0, normalizedDist);
        frameColor = mix(frameColor, vec3(0.15, 0.12, 0.08), innerShadow * 0.25);

        return vec4(frameColor, 1.0);
      }

      return originalColor;
    }

    // Glass effect function
    vec4 applyGlass(vec2 uv, vec4 originalColor) {
      vec2 center = vec2(0.5, 0.5);

      // Subtle distortion for glass effect
      vec2 distortion = (uv - center) * 0.002 * u_glassIntensity;
      vec2 distortedUV = uv + distortion;

      // Sample the distorted texture
      vec4 distortedColor = texture2D(u_texture, distortedUV);

      // Add reflection highlights
      float reflectionMask = pow(1.0 - length(uv - center) * 1.4, 2.0);
      reflectionMask = clamp(reflectionMask, 0.0, 1.0);

      // Create subtle highlight streaks
      float highlight1 = smoothstep(0.0, 0.1, sin((uv.x + uv.y) * 10.0) * 0.5 + 0.5);
      float highlight2 = smoothstep(0.0, 0.05, sin((uv.x - uv.y) * 15.0) * 0.5 + 0.5);

      float totalHighlight = (highlight1 + highlight2) * reflectionMask * u_glassIntensity * 0.1;

      // Apply vignette for depth
      float vignette = 1.0 - length(uv - center) * 0.8;
      vignette = smoothstep(0.0, 1.0, vignette);

      // Combine effects
      vec3 finalColor = mix(originalColor.rgb, distortedColor.rgb, 0.3);
      finalColor += vec3(totalHighlight);
      finalColor *= vignette;

      return vec4(finalColor, originalColor.a);
    }

    void main() {
      vec2 uv = v_texCoord;

      // Sample original texture
      vec4 originalColor = texture2D(u_texture, uv);

      // Apply glass effect first (only to the art area)
      vec2 center = vec2(0.5, 0.5);
      vec2 dist = abs(uv - center);
      bool inArtArea = (dist.x <= 0.5 - u_frameWidth && dist.y <= 0.5 - u_frameWidth);

      vec4 processedColor = originalColor;
      if (inArtArea) {
        processedColor = applyGlass(uv, originalColor);
      }

      // Apply frame effect
      processedColor = applyFrame(uv, processedColor);

      gl_FragColor = processedColor;
    }
  `;

  // Shader compilation utilities
  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program linking error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  // Main shader system class
  class FrameGlassShader {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

      if (!this.gl) {
        console.error('WebGL not supported in this browser');
        throw new Error('WebGL not supported');
      }

      console.log('WebGL context acquired successfully');
      console.log('WebGL version:', this.gl.getParameter(this.gl.VERSION));
      console.log('WebGL vendor:', this.gl.getParameter(this.gl.VENDOR));
      console.log('WebGL renderer:', this.gl.getParameter(this.gl.RENDERER));

      this.init();
    }

    init() {
      const gl = this.gl;

      // Create shaders
      const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

      if (!vertexShader || !fragmentShader) {
        throw new Error('Failed to create shaders');
      }

      // Create program
      this.program = createProgram(gl, vertexShader, fragmentShader);
      if (!this.program) {
        throw new Error('Failed to create shader program');
      }

      // Get attribute and uniform locations
      this.locations = {
        attributes: {
          position: gl.getAttribLocation(this.program, 'a_position'),
          texCoord: gl.getAttribLocation(this.program, 'a_texCoord')
        },
        uniforms: {
          texture: gl.getUniformLocation(this.program, 'u_texture'),
          resolution: gl.getUniformLocation(this.program, 'u_resolution'),
          frameWidth: gl.getUniformLocation(this.program, 'u_frameWidth'),
          glassIntensity: gl.getUniformLocation(this.program, 'u_glassIntensity'),
          reflectionIntensity: gl.getUniformLocation(this.program, 'u_reflectionIntensity'),
          mousePosition: gl.getUniformLocation(this.program, 'u_mousePosition')
        }
      };

      // Create geometry
      this.setupGeometry();

      // Create texture
      this.texture = gl.createTexture();

      // Set default parameters
      this.frameWidth = 0.08; // 8% of canvas
      this.glassIntensity = 1.0;
      this.reflectionIntensity = 0.6; // Subtle but noticeable reflections
      this.mousePosition = { x: 0.5, y: 0.5 }; // Center position as default
    }

    setupGeometry() {
      const gl = this.gl;

      // Create quad vertices (two triangles)
      const vertices = new Float32Array([
        -1, -1,  0, 0,  // bottom-left
         1, -1,  1, 0,  // bottom-right
        -1,  1,  0, 1,  // top-left
         1,  1,  1, 1   // top-right
      ]);

      // Create buffer
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    }

    updateTexture(sourceCanvas) {
      const gl = this.gl;

      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

      // Set texture parameters
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    render(sourceCanvas) {
      const gl = this.gl;

      // Update texture with source canvas content
      this.updateTexture(sourceCanvas);

      // Set viewport
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);

      // Use shader program
      gl.useProgram(this.program);

      // Bind vertex buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

      // Set up attributes
      gl.enableVertexAttribArray(this.locations.attributes.position);
      gl.vertexAttribPointer(this.locations.attributes.position, 2, gl.FLOAT, false, 16, 0);

      gl.enableVertexAttribArray(this.locations.attributes.texCoord);
      gl.vertexAttribPointer(this.locations.attributes.texCoord, 2, gl.FLOAT, false, 16, 8);

      // Set uniforms
      gl.uniform1i(this.locations.uniforms.texture, 0);
      gl.uniform2f(this.locations.uniforms.resolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.locations.uniforms.frameWidth, this.frameWidth);
      gl.uniform1f(this.locations.uniforms.glassIntensity, this.glassIntensity);
      gl.uniform1f(this.locations.uniforms.reflectionIntensity, this.reflectionIntensity);
      gl.uniform2f(this.locations.uniforms.mousePosition, this.mousePosition.x, this.mousePosition.y);

      // Bind texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);

      // Draw
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    setFrameWidth(width) {
      this.frameWidth = Math.max(0.01, Math.min(0.2, width));
    }

    setGlassIntensity(intensity) {
      this.glassIntensity = Math.max(0.0, Math.min(2.0, intensity));
    }

    setReflectionIntensity(intensity) {
      this.reflectionIntensity = Math.max(0.0, Math.min(1.5, intensity));
    }

    setMousePosition(x, y) {
      this.mousePosition.x = Math.max(0.0, Math.min(1.0, x));
      this.mousePosition.y = Math.max(0.0, Math.min(1.0, y));
    }

    resize(width, height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    destroy() {
      const gl = this.gl;

      if (this.program) {
        gl.deleteProgram(this.program);
      }
      if (this.vertexBuffer) {
        gl.deleteBuffer(this.vertexBuffer);
      }
      if (this.texture) {
        gl.deleteTexture(this.texture);
      }
    }
  }

  // Export the shader system
  window.FrameGlassShader = FrameGlassShader;
})();