import { useUserProfileController, type UserProfileProps } from '../hooks/useUserProfileController';
import UserProfileView from './UserProfileView';

export default function UserProfile(props: UserProfileProps) {
  const controller = useUserProfileController(props);
  return <UserProfileView controller={controller} currentUser={props.currentUser} state={props.state} loadState={props.loadState} />;
}
