import React from 'react';
import { Alert, Layout } from 'antd';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI error', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <Layout style={{ padding: 24 }}>
          <Alert
            type="error"
            showIcon
            message="渲染出错"
            description={this.state.error?.message || String(this.state.error)}
          />
        </Layout>
      );
    }
    return this.props.children;
  }
}

