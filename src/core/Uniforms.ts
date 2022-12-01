class Uniforms {
  private _member: ProxyConstructor;

  private bufferMembers: { key: string; value: any }[] = [];
  private textures: { key: string; value: GPUTexture }[] = [];

  private uniformsArray: Float32Array;
  private uniformsArrayMemberMetadata: {
    [key: string]: { index: number; length: number };
  } = {};
  private uniformsBuffer: GPUBuffer;
  private bufferNeedsUpdate = true;
  private _bindGroup: GPUBindGroup;
  private _bindGroupLayout: GPUBindGroupLayout;
  public autoUpdate = true;

  constructor(private device: GPUDevice, members: { [key: string]: any }) {
    for (let key in members) {
      const value = members[key];

      if (value instanceof GPUTexture) {
        this.textures.push({ key, value });
      } else {
        this.bufferMembers.push({ key, value });
      }
    }

    this.createArraysAndBuffers();
    this.createBindGroup();

    const handler = {
      get: (target, prop) => {
        return this.proxyGetHandler(target, prop);
      },
      set: (target, prop, reciever) => {
        return this.proxySetHandler(target, prop, reciever);
      },
    };
    this._member = new Proxy({}, handler);
  }

  private createArraysAndBuffers(): void {
    const arrayData: number[] = [];

    // TODO, array padding and alignment;
    for (let { key, value: _value } of this.bufferMembers) {
      let arrayIndex = arrayData.length;

      const value = _value.byteLength ? Array.from(_value) : _value;

      if (Array.isArray(value)) {
        const rowSpace = 4 - (arrayIndex % 4);

        switch (rowSpace) {
          case 1: {
            arrayData.push(0); // padding
            break;
          }
          case 2: {
            if (value.length > 2) {
              arrayData.push(0, 0); // padding
            }
            break;
          }
          case 3: {
            if (value.length === 2) {
              arrayData.push(0);
            } else {
              arrayData.push(0, 0, 0);
            }
            break;
          }
          default: {
            break;
          }
        }
        arrayIndex = arrayData.length;
        arrayData.push(...value);
      } else {
        arrayData.push(value);
      }
      this.uniformsArrayMemberMetadata[key] = {
        index: arrayIndex,
        length: Array.isArray(value) ? value.length : 1,
      };
    }

    this.uniformsBuffer = this.device.createBuffer({
      size: arrayData.length * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uniformsArray = new Float32Array(arrayData);
    this.update();
  }

  private createBindGroup(): void {
    const entriesLayout: GPUBindGroupLayoutEntry[] = [];
    entriesLayout.push({
      binding: entriesLayout.length,
      visibility:
        GPUShaderStage.VERTEX |
        GPUShaderStage.FRAGMENT |
        GPUShaderStage.COMPUTE,
      buffer: { type: "uniform" },
    });

    this.textures.forEach(({ value }) => {
      entriesLayout.push({
        binding: entriesLayout.length,
        visibility:
          GPUShaderStage.VERTEX |
          GPUShaderStage.FRAGMENT |
          GPUShaderStage.COMPUTE,
        sampler: { type: "filtering" },
      });
      entriesLayout.push({
        binding: entriesLayout.length,
        visibility:
          GPUShaderStage.VERTEX |
          GPUShaderStage.FRAGMENT |
          GPUShaderStage.COMPUTE,
        texture: {
          sampleType: "float",
          multisampled: false,
          viewDimension: value.dimension,
        },
      });
    });

    this._bindGroupLayout = this.device.createBindGroupLayout({
      entries: entriesLayout,
    });

    const entries: GPUBindGroupEntry[] = [];
    entries.push({
      binding: 0,
      resource: {
        buffer: this.uniformsBuffer,
      },
    });
    this.textures.forEach(({ value }) => {
      entries.push({
        binding: entries.length,
        resource: this.device.createSampler({
          magFilter: "linear",
          minFilter: "linear",
        }),
      });
      entries.push({
        binding: entries.length,
        resource: value.createView({ dimension: value.dimension }),
      });
    });

    this._bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries,
    });
  }

  private proxyGetHandler(target, prop) {
    const { index, length } = this.uniformsArrayMemberMetadata[prop];

    if (length > 1) {
      return Array.from(this.uniformsArray.slice(index, length));
    }
    return this.uniformsArray[index];
  }

  private proxySetHandler(target, prop, reciever) {
    const { index } = this.uniformsArrayMemberMetadata[prop];

    if (reciever.byteLength) {
      reciever = Array.from(reciever);
    }
    if (Array.isArray(reciever)) {
      this.uniformsArray.set(reciever, index);
    } else {
      this.uniformsArray.set([reciever], index);
    }
    this.bufferNeedsUpdate = true;

    if (this.autoUpdate) {
      this.update();
    }
    return true;
  }

  public get member(): any {
    return this._member;
  }

  public get bindGroupLayout(): GPUBindGroupLayout {
    return this._bindGroupLayout;
  }

  public get bindGroup(): GPUBindGroup {
    return this._bindGroup;
  }

  public getWgslChunk(
    groupIndex: string | number = "[REPLACE_WITH_GROUP_INDEX]",
    uniformsName: string = ""
  ): string {
    const structName = `Uniforms${
      uniformsName.charAt(0).toUpperCase() + uniformsName.slice(1)
    }`;
    return `
    ${structName} {
        ${this.bufferMembers.reduce((acc, { key, value }) => {
          const type = Array.isArray(value) ? `vec${value.length}<f32>` : "f32";
          if (acc === "") {
            return `${key} : ${type},`;
          } else {
            return `${acc}
        ${key} : ${type},`;
          }
        }, "")}
    }

    @group(${groupIndex}) @binding(0) var<uniform> uniforms${
      uniformsName ? "_" : ""
    }${uniformsName} : ${structName};
    `;
  }

  public update() {
    if (!this.bufferNeedsUpdate) return;
    this.device.queue.writeBuffer(this.uniformsBuffer, 0, this.uniformsArray);
    this.bufferNeedsUpdate = false;
  }
}

export default Uniforms;
